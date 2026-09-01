import { api, ApiError } from "@/api/client";
import { uuidv7 } from "@/core/uuidv7";
import { db, type LocalOrder, type SyncOperation } from "@/db/schema";

/**
 * Settling a rejected operation.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: every resolution that re-pushes must
 * mint a NEW operation_id.
 *
 * The server records each operation_id it has seen, including the ones it
 * rejected. Re-pushing a corrected payload under the original id hits the
 * idempotency short-circuit: the server answers "duplicate" from the stored
 * conflict result and applies nothing. The client would delete the outbox row
 * believing it succeeded, and the sale would be gone — money taken, receipt
 * printed, nothing on the books. That is the worst failure this system can
 * produce, and it looks like success.
 *
 * So `reissueOrder` and `retryOperation` both replace the row rather than
 * updating it in place.
 */

export type ConflictResolution = "reissued" | "retried" | "discarded";

/**
 * A receipt number that is genuinely free across the whole store.
 *
 * The server is asked first, because only it sees every till's numbers. Deriving
 * this locally is what caused the collision in the first place: a till that was
 * offline does not know which numbers the other tills consumed, so re-issuing
 * from local state can clash again, and again, once per attempt.
 *
 * The local fallback is for the case where the server cannot be reached. It
 * stays within the CLASHED number's own date prefix and takes the highest
 * sequence this device has seen under it.
 *
 * Staying within that prefix is the whole point. An earlier version compared the
 * clashed sequence against today's next number, which is a comparison across two
 * different date prefixes and therefore meaningless: settling a conflict on
 * yesterday's OM-20260831-0001 against today's OM-20260901-0001 found 1 was not
 * greater than 1 and proposed -0002 — then proposed -0002 again for the next
 * conflict, because nothing it looked at had changed. Two sales, one number,
 * offline, which is exactly the failure being resolved.
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

  // Every number this device has issued under the same prefix, plus the one that
  // just clashed. Successive re-issues therefore keep advancing.
  const sameDay = await db.orders
    .where("store_id")
    .equals(storeId)
    .filter((o) => o.order_number.startsWith(prefix))
    .toArray();

  const highest = sameDay.reduce((max, o) => Math.max(max, seq(o.order_number)), seq(clashedWith));

  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

/**
 * The common case: two offline tills issued the same receipt number, and both
 * sales are real. Neither may be thrown away — each has a customer holding a
 * receipt — so the local one is re-issued under the next free number.
 *
 * The order keeps its id. Only the human-facing number collided; the UUID never
 * did, so the record's identity is unchanged and the re-push is still a clean
 * upsert of the same record.
 */
export async function reissueOrder(operationId: string): Promise<{ from: string; to: string }> {
  const op = await db.outbox.get(operationId);
  if (!op) throw new Error("That operation is no longer queued.");
  if (op.entity !== "orders") throw new Error("Only orders can be re-issued under a new number.");

  const order = await db.orders.get(op.record_id);
  if (!order) throw new Error("The sale is no longer on this device.");

  const previousNumber = order.order_number;
  const freshNumber = await freeReceiptNumber(op.store_id, previousNumber);

  await db.transaction("rw", [db.orders, db.outbox], async () => {
    await db.orders.update(order.id, { order_number: freshNumber, _state: "pending" });

    const payload = { ...(op.payload as Record<string, unknown>), order_number: freshNumber };

    // Replaced, not updated: a fresh operation_id is what makes the server
    // treat this as new work instead of replaying the rejection.
    await db.outbox.delete(operationId);
    await db.outbox.put({
      ...op,
      operation_id: uuidv7(),
      payload,
      status: "pending",
      attempts: 0,
      last_error: null,
      created_at: new Date().toISOString(),
    });
  });

  return { from: previousNumber, to: freshNumber };
}

/**
 * For conflicts whose cause was outside the payload — a product another till
 * deleted and has since restored, say. The data is unchanged; only the
 * circumstances were wrong.
 */
export async function retryOperation(operationId: string): Promise<void> {
  const op = await db.outbox.get(operationId);
  if (!op) throw new Error("That operation is no longer queued.");

  await db.transaction("rw", [db.orders, db.outbox], async () => {
    await db.outbox.delete(operationId);
    await db.outbox.put({
      ...op,
      operation_id: uuidv7(),
      status: "pending",
      attempts: 0,
      last_error: null,
      created_at: new Date().toISOString(),
    });

    if (op.entity === "orders") {
      await db.orders.update(op.record_id, { _state: "pending" });
    }
  });
}

/**
 * The operation should not reach the server at all — a genuine double-entry, or
 * a sale already booked from another device.
 *
 * The local record is marked `discarded` rather than deleted. Someone took money
 * against it and may hold a receipt; erasing the evidence would leave nothing to
 * investigate. It simply stops claiming to be a booked sale.
 */
export async function discardOperation(operationId: string): Promise<void> {
  const op = await db.outbox.get(operationId);
  if (!op) return;

  await db.transaction("rw", [db.orders, db.outbox], async () => {
    await db.outbox.delete(operationId);
    if (op.entity === "orders") {
      await db.orders.update(op.record_id, { _state: "discarded" });
    }
  });
}

/**
 * Tell the server the conflict has been settled, so the same problem is not
 * worked twice by two people on two devices.
 *
 * Best-effort by design: the local resolution has already happened and must not
 * be undone because the network is down. An unacknowledged conflict shows as
 * pending to a manager, which is the safe direction to be wrong in.
 */
export async function acknowledgeOnServer(
  operationId: string,
  resolution: ConflictResolution,
  note?: string,
): Promise<boolean> {
  // This till fixed the sale itself and is re-pushing it, so the server must NOT
  // re-apply anything — it would book the same sale twice, once from the stored
  // payload and once from the corrected push. "acknowledge" only marks the row
  // settled.
  const action = resolution === "discarded" ? "discard" : "acknowledge";

  try {
    await api.post(`/api/sync/conflicts/${operationId}/resolve`, {
      action,
      note: note ?? null,
    });
    return true;
  } catch (error) {
    // 409 means someone else already settled it — not a failure worth surfacing.
    if (error instanceof ApiError && error.status === 409) return true;
    return false;
  }
}

/** Conflicts still awaiting a decision on this device. */
export async function localConflicts(storeId: string): Promise<SyncOperation[]> {
  return db.outbox.where("store_id").equals(storeId).filter((o) => o.status === "conflict").toArray();
}

/** The sale behind a conflicted operation, for showing what is actually at stake. */
export async function conflictedOrder(op: SyncOperation): Promise<LocalOrder | undefined> {
  if (op.entity !== "orders") return undefined;
  return db.orders.get(op.record_id);
}
