import { api, ApiError } from "@/api/client";
import { db, getMeta, setMeta, type SyncOperation } from "@/db/schema";
import { uuidv7 } from "@/core/uuidv7";

/**
 * Push/pull synchronisation against the Laravel API.
 *
 * This is the canonical client for the OmniPOS sync protocol. The mobile app
 * still speaks to Supabase through its own engine; when it is repointed at
 * Laravel it should adopt this one rather than growing a second implementation.
 *
 * Two properties the whole design rests on:
 *
 * PUSH IS IDEMPOTENT. Every outbox row carries an operation_id generated once,
 * at the moment the local write happened, and reused unchanged on every retry.
 * If the connection drops after the server commits but before the response
 * arrives, the retry is recognised server-side and answered from the stored
 * result. Without that, a checkout interrupted at the wrong moment books the
 * sale twice.
 *
 * PULL NEVER SKIPS. The cursor is the server's monotonic sync_changes.sequence,
 * not a timestamp. Timestamps are unsafe across devices with skewed clocks, and
 * two changes written in the same millisecond can straddle a cursor boundary
 * with one lost for ever.
 */

const CURSOR_KEY = "sync.cursor";
const DEVICE_KEY = "sync.device_id";
const LAST_SYNC_KEY = "sync.last_completed_at";

const MAX_ATTEMPTS = 8;
const PUSH_BATCH = 100;
const PULL_LIMIT = 500;

export type SyncResult = {
  pushed: number;
  conflicts: number;
  pulled: number;
  ok: boolean;
  reason?: string;
};

export type PushOperationResult = {
  operation_id: string;
  status: "applied" | "duplicate" | "conflict" | "failed";
  record_id: string | null;
  reason?: string;
  result?: unknown;
};

/** Stable per-browser-profile identity, so the server can attribute operations. */
export async function getDeviceId(): Promise<string> {
  let id = await getMeta<string | null>(DEVICE_KEY, null);
  if (!id) {
    id = uuidv7();
    await setMeta(DEVICE_KEY, id);
  }
  return id;
}

/** Queue a local change for the server. Called after the local write commits. */
export async function enqueue(input: {
  storeId: string;
  entity: string;
  action: "upsert" | "delete";
  recordId: string;
  payload: unknown;
}): Promise<void> {
  await db.outbox.put({
    // Generated once, here. Never regenerated on retry — that is the whole point.
    operation_id: uuidv7(),
    store_id: input.storeId,
    entity: input.entity,
    action: input.action,
    record_id: input.recordId,
    payload: input.payload,
    attempts: 0,
    last_error: null,
    status: "pending",
    created_at: new Date().toISOString(),
  });
}

export async function pendingCount(storeId: string): Promise<number> {
  return db.outbox.where("store_id").equals(storeId).filter((o) => o.status === "pending").count();
}

export async function conflicts(storeId: string): Promise<SyncOperation[]> {
  return db.outbox.where("store_id").equals(storeId).filter((o) => o.status === "conflict").toArray();
}

export async function registerDevice(): Promise<void> {
  const deviceId = await getDeviceId();
  await api.post("/api/sync/devices", {
    device_id: deviceId,
    platform: "web",
    terminal_label: await getMeta<string | null>("terminal_label", null),
    app_version: __APP_VERSION__,
  });
}

/**
 * Push, then pull. Push first so that a sale made seconds ago is on the server
 * before we ask what changed — otherwise the pull can hand back a stale version
 * of a record this till just modified.
 */
export async function runSync(storeId: string): Promise<SyncResult> {
  if (!navigator.onLine) {
    return { ok: false, pushed: 0, conflicts: 0, pulled: 0, reason: "offline" };
  }

  try {
    const pushed = await pushOutbox(storeId);
    const pulled = await pullChanges(storeId);

    await setMeta(LAST_SYNC_KEY, new Date().toISOString());

    return { ok: true, pushed: pushed.applied, conflicts: pushed.conflicts, pulled };
  } catch (error) {
    if (error instanceof ApiError && error.isUnreachable) {
      return { ok: false, pushed: 0, conflicts: 0, pulled: 0, reason: "offline" };
    }
    throw error;
  }
}

async function pushOutbox(storeId: string): Promise<{ applied: number; conflicts: number }> {
  let applied = 0;
  let conflicted = 0;

  for (;;) {
    const batch = await db.outbox
      .where("store_id")
      .equals(storeId)
      .filter((o) => o.status === "pending" && o.attempts < MAX_ATTEMPTS)
      .limit(PUSH_BATCH)
      .toArray();

    if (batch.length === 0) break;

    const deviceId = await getDeviceId();

    const response = await api.post<{ results: PushOperationResult[] }>("/api/sync/push", {
      device_id: deviceId,
      operations: batch.map((op) => ({
        operation_id: op.operation_id,
        entity: op.entity,
        action: op.action,
        record_id: op.record_id,
        payload: op.payload,
      })),
    });

    const byId = new Map(response.results.map((r) => [r.operation_id, r]));

    // db.products is here for reverseRejectedMovement: undoing an optimistic
    // adjustment writes to it, and Dexie refuses a table the transaction did
    // not declare.
    await db.transaction(
      "rw",
      [db.outbox, db.orders, db.customers, db.shifts, db.returns, db.products],
      async () => {
        for (const op of batch) {
          const result = byId.get(op.operation_id);

          if (!result) {
            await db.outbox.update(op.operation_id, {
              attempts: op.attempts + 1,
              last_error: "No result returned for this operation.",
            });
            continue;
          }

          // A duplicate is a success: the server already has this write, which is
          // exactly what a retry after a dropped response looks like.
          if (result.status === "applied" || result.status === "duplicate") {
            await db.outbox.delete(op.operation_id);
            await markClean(op);
            applied += 1;
            continue;
          }

          if (result.status === "conflict") {
            // Kept, not discarded. A rejected sale needs a person to look at it.
            await db.outbox.update(op.operation_id, {
              status: "conflict",
              last_error: result.reason ?? "Rejected by the server.",
            });

            // Flag the record too, so the Orders list cannot show a rejected sale
            // as though it were on the books.
            if (op.entity === "orders") {
              await db.orders.update(op.record_id, { _state: "conflict" });
            } else if (op.entity === "register_shifts") {
              await db.shifts.update(op.record_id, { _state: "conflict" });
            } else if (op.entity === "returns") {
              // A refund the server refused is the one a cashier most needs to
              // see: the money is already out of the drawer.
              //
              // The restock is deliberately NOT reversed. The goods are
              // physically back on the shelf whatever the server decided, so
              // taking them off the local figure would make the till disagree
              // with the room it is standing in. A manager settles it.
              await db.returns.update(op.record_id, { _state: "conflict" });
            } else if (op.entity === "stock_movements") {
              await reverseRejectedMovement(op);
            }

            conflicted += 1;
            continue;
          }

          await db.outbox.update(op.operation_id, {
            attempts: op.attempts + 1,
            last_error: result.reason ?? "Failed.",
          });
        }
      },
    );

    if (batch.length < PUSH_BATCH) break;
  }

  return { applied, conflicts: conflicted };
}

/**
 * Undo the local effect of a stock movement the server refused.
 *
 * An adjustment is applied optimistically so the shelf figure updates as the
 * manager types. If the server rejects it — an unknown movement type, a product
 * deleted on another device — that adjustment happened nowhere, yet the local
 * cache is still carrying it. Nothing else corrects it either: the changefeed
 * publishes the movement, not the product, so the drift would sit there until
 * the next full bootstrap.
 *
 * Reversing by the payload's own quantity rather than refetching keeps this
 * exact even when several adjustments are queued against one product.
 */
async function reverseRejectedMovement(op: SyncOperation): Promise<void> {
  const payload = op.payload as { product_id?: unknown; quantity?: unknown } | null;
  const productId = payload?.product_id;
  const quantity = Number(payload?.quantity ?? 0);

  if (typeof productId !== "string" || !Number.isFinite(quantity) || quantity === 0) return;

  const product = await db.products.get(productId);
  if (!product) return;

  await db.products.update(productId, { stock: product.stock - quantity });
}

async function markClean(op: SyncOperation): Promise<void> {
  if (op.entity === "orders") {
    await db.orders.update(op.record_id, { _state: "clean" });
  } else if (op.entity === "customers") {
    await db.customers.update(op.record_id, { _state: "clean" });
  } else if (op.entity === "register_shifts") {
    await db.shifts.update(op.record_id, { _state: "clean" });
  } else if (op.entity === "returns") {
    await db.returns.update(op.record_id, { _state: "clean" });
  }
}

/**
 * Pull changes after the stored cursor and apply them locally.
 *
 * The server omits changes this device originated, so a till never re-applies
 * its own writes over newer local edits.
 */
async function pullChanges(storeId: string): Promise<number> {
  const deviceId = await getDeviceId();
  let cursor = await getMeta<number>(CURSOR_KEY, 0);
  let total = 0;

  for (;;) {
    const page = await api.get<{
      cursor: number;
      has_more: boolean;
      changes: Array<{
        sequence: number;
        entity: string;
        action: "upsert" | "delete";
        record_id: string;
        payload: Record<string, unknown>;
      }>;
    }>("/api/sync/pull", { cursor, limit: PULL_LIMIT, device_id: deviceId });

    if (page.changes.length === 0) {
      // Still advance: the server may have skipped this device's own changes.
      if (page.cursor > cursor) {
        cursor = page.cursor;
        await setMeta(CURSOR_KEY, cursor);
      }
      break;
    }

    await applyChanges(storeId, page.changes);

    total += page.changes.length;
    cursor = page.cursor;
    await setMeta(CURSOR_KEY, cursor);

    if (!page.has_more) break;
  }

  return total;
}

export async function applyChangesForTest(
  changes: Array<{ entity: string; action: string; record_id: string; payload: Record<string, unknown> }>,
): Promise<void> {
  // Test seam: the pull loop is network-bound, but applying what it returns is
  // pure local logic and is where the conflict-clearing behaviour lives.
  return applyChanges("", changes);
}

async function applyChanges(
  storeId: string,
  changes: Array<{ entity: string; action: string; record_id: string; payload: Record<string, unknown> }>,
): Promise<void> {
  await db.transaction(
    "rw",
    [db.products, db.categories, db.customers, db.orders, db.shifts, db.returns, db.outbox],
    async () => {
      for (const change of changes) {
        if (change.action === "delete") {
          await deleteLocal(change.entity, change.record_id);
          continue;
        }

        const p = change.payload;

        switch (change.entity) {
          case "products":
            await db.products.put(mapProduct(storeId, p));
            break;
          case "customers": {
            // A local edit not yet pushed outranks the server's copy; overwriting
            // it would throw away work the cashier has already done.
            const existing = await db.customers.get(change.record_id);
            if (existing?._state === "pending") break;
            await db.customers.put(mapCustomer(storeId, p));
            break;
          }
          case "orders":
            await adoptServerOrder(change.record_id, p);
            break;
          case "register_shifts":
            await adoptServerShift(change.record_id, p);
            break;
          case "returns":
            await adoptServerReturn(change.record_id);
            break;
          default:
            // Entities the till does not keep locally (price history, movements)
            // are ignored rather than treated as an error.
            break;
        }

        // Whatever the entity, if the server has now applied this record then any
        // conflict this till was still holding for it is settled. A manager may
        // have booked it from another device.
        await clearSettledConflict(change.record_id);
      }
    },
  );
}

/**
 * Take the server's version of a sale this till already holds.
 *
 * This is how a till discovers that a manager settled its conflict from another
 * device: the sale comes back through the changefeed, usually under a different
 * receipt number, and the local copy is corrected to match. Reprinting then
 * produces the number that is actually on the books.
 *
 * A sale still queued locally is left alone — it has not been booked yet, and
 * overwriting it would discard the cashier's own work.
 */
async function adoptServerOrder(recordId: string, payload: Record<string, unknown>): Promise<void> {
  const local = await db.orders.get(recordId);
  if (!local) return;
  if (local._state === "pending") return;

  const serverNumber = payload.order_number ? String(payload.order_number) : local.order_number;

  await db.orders.update(recordId, {
    order_number: serverNumber,
    status: payload.status ? String(payload.status) : local.status,
    amount_paid: payload.amount_paid !== undefined ? String(payload.amount_paid) : local.amount_paid,
    _state: "clean",
  });
}

/**
 * Take the server's version of a drawer session.
 *
 * The figure that matters is expected_cash. The till computes its own so a
 * cashier can close with no connection, but that number only knows this
 * terminal's sales; the server recomputes it from the payments ledger, which
 * includes anything that reached it by another route. When the server has
 * spoken, its figure replaces the local one.
 */
async function adoptServerShift(recordId: string, payload: Record<string, unknown>): Promise<void> {
  const local = await db.shifts.get(recordId);
  if (!local) return;

  // Still queued locally: the cashier may be mid-count, and the server has not
  // seen this version yet.
  if (local._state === "pending") return;

  await db.shifts.update(recordId, {
    status: payload.status === "closed" ? "closed" : "open",
    closed_at: payload.closed_at ? String(payload.closed_at) : local.closed_at,
    expected_cash: payload.expected_cash !== undefined && payload.expected_cash !== null
      ? String(payload.expected_cash)
      : local.expected_cash,
    actual_cash: payload.actual_cash !== undefined && payload.actual_cash !== null
      ? String(payload.actual_cash)
      : local.actual_cash,
    _state: "clean",
  });
}

/**
 * A refund the server has accepted.
 *
 * Only the state is taken. The lines and the amount were decided at the till
 * where the goods were handed back, and the server does not alter them — so
 * there is nothing to copy back, only the fact that it is now on the books.
 */
async function adoptServerReturn(recordId: string): Promise<void> {
  const local = await db.returns.get(recordId);
  if (!local || local._state === "pending") return;

  await db.returns.update(recordId, { _state: "clean" });
}

/**
 * Drop a conflicted operation once the server has the record.
 *
 * Without this the till would keep showing "needs a decision" for a sale that is
 * already on the books — and a second manager might settle it again.
 */
async function clearSettledConflict(recordId: string): Promise<void> {
  const held = await db.outbox.where("record_id").equals(recordId).toArray();

  for (const op of held) {
    if (op.status === "conflict") {
      await db.outbox.delete(op.operation_id);
    }
  }
}

async function deleteLocal(entity: string, id: string): Promise<void> {
  if (entity === "products") await db.products.delete(id);
  if (entity === "customers") await db.customers.delete(id);
}

function str(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

export function mapProduct(storeId: string, p: Record<string, unknown>) {
  const name = str(p.name);
  const sku = str(p.sku);
  return {
    id: str(p.id),
    store_id: str(p.store_id, storeId),
    category_id: p.category_id ? str(p.category_id) : null,
    name,
    sku,
    barcode: p.barcode ? str(p.barcode) : null,
    price: str(p.price, "0"),
    cost_price: p.cost_price === null || p.cost_price === undefined ? null : str(p.cost_price),
    stock: Number(p.stock ?? 0),
    reorder_level: Number(p.reorder_level ?? 0),
    image_url: p.image_url ? str(p.image_url) : null,
    tags: Array.isArray(p.tags) ? (p.tags as string[]) : [],
    is_active: p.is_active !== false,
    updated_at: str(p.updated_at, new Date().toISOString()),
    search_key: `${name} ${sku}`.toLowerCase(),
  };
}

export function mapCustomer(storeId: string, c: Record<string, unknown>) {
  const name = str(c.name);
  const phone = c.phone ? str(c.phone) : null;
  return {
    id: str(c.id),
    store_id: str(c.store_id, storeId),
    name,
    phone,
    email: c.email ? str(c.email) : null,
    total_spend: str(c.total_spend, "0.00"),
    outstanding_balance: str(c.outstanding_balance, "0.00"),
    updated_at: str(c.updated_at, new Date().toISOString()),
    search_key: `${name} ${phone ?? ""}`.toLowerCase(),
    _state: "clean" as const,
  };
}

/**
 * First run for a store: fetch the catalogue over REST rather than replaying the
 * entire changefeed from sequence zero, then jump the cursor to the current head
 * so the next pull only carries genuinely new changes.
 */
export async function bootstrapStore(storeId: string): Promise<{ products: number; customers: number }> {
  await registerDevice();

  let products = 0;
  for (let page = 1; ; page += 1) {
    const res = await api.get<{ data: Record<string, unknown>[]; meta?: { last_page?: number } }>(
      "/api/products",
      { per_page: 200, page },
    );
    if (!res.data?.length) break;
    await db.products.bulkPut(res.data.map((p) => mapProduct(storeId, p)));
    products += res.data.length;
    if (!res.meta?.last_page || page >= res.meta.last_page) break;
  }

  let customers = 0;
  for (let page = 1; ; page += 1) {
    const res = await api.get<{ data: Record<string, unknown>[]; meta?: { last_page?: number } }>(
      "/api/customers",
      { per_page: 200, page },
    );
    if (!res.data?.length) break;
    await db.customers.bulkPut(res.data.map((c) => mapCustomer(storeId, c)));
    customers += res.data.length;
    if (!res.meta?.last_page || page >= res.meta.last_page) break;
  }

  const categories = await api.get<{ data: Record<string, unknown>[] }>("/api/categories");
  await db.categories.bulkPut(
    (categories.data ?? []).map((c) => ({
      id: str(c.id),
      store_id: storeId,
      name: str(c.name),
      color: c.color ? str(c.color) : null,
      position: Number(c.position ?? 0),
    })),
  );

  // Move the cursor to the current head: everything before it is already in the
  // snapshot we just fetched, and replaying it would be wasted work.
  const head = await api.get<{ cursor: number }>("/api/sync/pull", { cursor: 0, limit: 1 });
  await setMeta(CURSOR_KEY, head.cursor ?? 0);

  return { products, customers };
}

export async function lastSyncedAt(): Promise<string | null> {
  return getMeta<string | null>(LAST_SYNC_KEY, null);
}
