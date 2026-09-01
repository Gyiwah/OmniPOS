import { Q } from "@nozbe/watermelondb";
import { database } from "@/src/database";
import Order from "@/src/database/models/Order";
import SyncQueueItem from "@/src/database/models/SyncQueueItem";
import { api, ApiError } from "@/src/core/api/client";

/**
 * Settling a rejected operation on a phone.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: every resolution that re-pushes must
 * become a NEW queue row.
 *
 * On this client the queue row's own id IS the operation_id sent to the server.
 * The server records every id it has seen, including the ones it rejected — so
 * re-pushing a corrected payload under the original row hits the idempotency
 * short-circuit: the server answers "duplicate" from the stored conflict result
 * and applies nothing. The client would delete the row believing it had
 * succeeded, and the sale would be gone. Money taken, receipt printed, nothing
 * on the books, and it looks exactly like success.
 *
 * So resolving destroys the row and creates a fresh one. Never update in place.
 */

export type ConflictResolution = "reissued" | "retried" | "discarded";

export type ConflictView = {
  operationId: string;
  entity: string;
  recordId: string;
  reason: string;
  payload: Record<string, unknown>;
  /** Present for orders: what the sale was, so a manager can see what is at stake. */
  order?: {
    id: string;
    orderNumber: string;
    total: number;
    amountPaid: number;
    customerName: string | null;
    createdAt: number;
  };
};

export async function listConflicts(storeId: string): Promise<ConflictView[]> {
  const rows = await database
    .get<SyncQueueItem>("sync_queue")
    .query(Q.where("store_id", storeId), Q.where("status", "conflict"))
    .fetch();

  return Promise.all(rows.map((row) => describe(row)));
}

async function describe(row: SyncQueueItem): Promise<ConflictView> {
  const view: ConflictView = {
    operationId: row.id,
    entity: row.entity,
    recordId: row.recordId ?? row.id,
    reason: row.lastError ?? "Rejected by the server.",
    payload: parse(row.payload),
  };

  if (row.entity !== "orders") return view;

  const order = await findOrder(row.storeId, row.recordId ?? "");
  if (order) {
    view.order = {
      id: order.id,
      orderNumber: order.orderNumber,
      total: Number(order.total ?? 0),
      amountPaid: Number(order.amountPaid ?? 0),
      customerName: order.customerName ?? null,
      createdAt: Number(order.createdAt ?? 0),
    };
  }

  return view;
}

/**
 * The common case: two tills issued the same receipt number while offline and
 * both sales are real. Neither may be thrown away — each has a customer holding
 * a receipt — so this one is re-issued under the next free number.
 *
 * The order keeps its id. Only the human-facing number collided.
 */
export async function reissueOrder(operationId: string): Promise<{ from: string; to: string }> {
  const row = await findQueueRow(operationId);
  if (row.entity !== "orders") throw new Error("Only sales can be re-issued under a new number.");

  const order = await findOrder(row.storeId, row.recordId ?? "");
  if (!order) throw new Error("That sale is no longer on this device.");

  const previous = order.orderNumber;
  const fresh = await freeReceiptNumber(row.storeId, previous);

  const payload = { ...parse(row.payload), order_number: fresh };

  await database.write(async () => {
    await order.update((rec) => {
      rec.orderNumber = fresh;
      rec.dirty = true;
    });

    await requeue(row, payload);
  });

  return { from: previous, to: fresh };
}

/**
 * For conflicts whose cause was outside the payload — a product another till
 * deleted and has since restored, a customer who has now synced. The data is
 * unchanged; only the circumstances were wrong.
 */
export async function retryOperation(operationId: string): Promise<void> {
  const row = await findQueueRow(operationId);
  const payload = parse(row.payload);

  await database.write(async () => {
    await requeue(row, payload);
  });
}

/**
 * The operation should not reach the server at all — a genuine double entry, or
 * a sale already booked from another device.
 *
 * The local sale is marked rather than deleted. Someone took money against it
 * and may hold a receipt; erasing the evidence would leave nothing to
 * investigate. It simply stops claiming to be a booked sale.
 */
export async function discardOperation(operationId: string): Promise<void> {
  const row = await findQueueRow(operationId);
  const order = row.entity === "orders" ? await findOrder(row.storeId, row.recordId ?? "") : null;

  await database.write(async () => {
    if (order) {
      await order.update((rec) => {
        rec.status = "discarded";
        rec.dirty = false;
      });
    }
    await row.destroyPermanently();
  });
}

/**
 * Tell the server this conflict has been settled, so two people on two devices
 * do not work the same problem twice.
 *
 * Best-effort by design: the local resolution has already happened and must not
 * be undone because the connection is down. An unacknowledged conflict shows as
 * still pending to a manager, which is the safe direction to be wrong in.
 */
export async function acknowledgeOnServer(
  operationId: string,
  resolution: ConflictResolution,
  note?: string,
): Promise<boolean> {
  // This device fixed the sale itself and is re-pushing it, so the server must
  // NOT re-apply anything — it would book the same sale twice, once from the
  // stored payload and once from the corrected push.
  const action = resolution === "discarded" ? "discard" : "acknowledge";

  try {
    await api.post(`/api/sync/conflicts/${operationId}/resolve`, { action, note: note ?? null });
    return true;
  } catch (error) {
    // 409 means someone else already settled it, which is not a failure.
    if (error instanceof ApiError && error.status === 409) return true;
    return false;
  }
}

/**
 * A receipt number that is genuinely free across the whole store.
 *
 * The server is asked first, because only it sees every till's numbers.
 * Deriving this locally is what caused the collision: a till that was offline
 * does not know which numbers the other tills consumed.
 *
 * The local fallback stays inside the CLASHED number's own date prefix and
 * takes the highest sequence this device has seen under it, so successive
 * re-issues keep advancing instead of proposing the same number twice.
 */
async function freeReceiptNumber(storeId: string, clashedWith: string): Promise<string> {
  try {
    const res = await api.get<{ order_number: string }>("/api/orders/next-number");
    if (res?.order_number && res.order_number !== clashedWith) return res.order_number;
  } catch {
    // Fall through to the local estimate.
  }

  const seq = (value: string) => Number.parseInt(value.slice(value.lastIndexOf("-") + 1), 10) || 0;
  const prefix = clashedWith.slice(0, clashedWith.lastIndexOf("-") + 1);

  const orders = await database.get<Order>("orders").query(Q.where("store_id", storeId)).fetch();

  const highest = orders
    .filter((o) => o.orderNumber?.startsWith(prefix))
    .reduce((max, o) => Math.max(max, seq(o.orderNumber)), seq(clashedWith));

  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

/**
 * Destroy the rejected row and queue a fresh one.
 *
 * Must be called inside a database.write. The new row gets a new id, and that
 * id is the new operation_id — which is the whole point.
 */
async function requeue(row: SyncQueueItem, payload: Record<string, unknown>): Promise<void> {
  const { storeId, entity, operation, recordId, remoteId } = row;

  await row.destroyPermanently();

  await database.get<SyncQueueItem>("sync_queue").create((rec) => {
    rec.storeId = storeId;
    rec.entity = entity;
    rec.operation = operation;
    rec.payload = JSON.stringify(payload);
    rec.recordId = recordId;
    rec.remoteId = remoteId;
    rec.status = "pending";
    rec.attempts = 0;
    rec.lastError = undefined;
  });
}

async function findQueueRow(operationId: string): Promise<SyncQueueItem> {
  try {
    return await database.get<SyncQueueItem>("sync_queue").find(operationId);
  } catch {
    throw new Error("That operation is no longer queued.");
  }
}

async function findOrder(storeId: string, orderId: string): Promise<Order | null> {
  if (!orderId) return null;

  try {
    return await database.get<Order>("orders").find(orderId);
  } catch {
    const rows = await database
      .get<Order>("orders")
      .query(Q.where("store_id", storeId), Q.where("id", orderId))
      .fetch();

    return rows[0] ?? null;
  }
}

function parse(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
