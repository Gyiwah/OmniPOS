import { Q, type Model } from "@nozbe/watermelondb";

import { api, ApiError } from "@/src/core/api/client";
import { uuidv7 } from "@/src/core/ids";
import { getDeviceId } from "./deviceId";
import { network, storage } from "@/src/core/platform";
import { database } from "@/src/database";
import type Customer from "@/src/database/models/Customer";
import type Product from "@/src/database/models/Product";
import type SyncQueueItem from "@/src/database/models/SyncQueueItem";
import { SYNC_STORAGE } from "./keys";
import { refreshPendingSyncCount } from "./syncCounters";
import { useSyncStore } from "@/src/store/syncStore";

/**
 * Push/pull synchronisation against the Laravel API.
 *
 * Speaks the same protocol as the web till, and deliberately mirrors its
 * structure: one implementation of the money path, expressed twice only because
 * the two clients have different local databases underneath.
 *
 * THE IDEMPOTENCY KEY IS THE QUEUE ROW'S OWN ID.
 *
 * Every sync_queue row now gets a UUIDv7 primary key, minted once when the local
 * write happened and never regenerated. That is exactly what the server's
 * operation_id needs to be. If the connection drops after the server commits but
 * before the response arrives, the retry carries the same id, the server
 * recognises it and replays the stored result instead of booking the sale twice.
 *
 * Nothing here may ever generate a fresh id for an existing queue row.
 */

const CURSOR_KEY = "omnipos_laravel_cursor";
const LAST_SYNC_KEY = "omnipos_laravel_last_sync";

const MAX_ATTEMPTS = 8;
const PUSH_BATCH = 100;
const PULL_LIMIT = 500;

/** Entities the server accepts. Anything else is a client bug, not a table we forgot. */
const SUPPORTED = new Set([
  "products",
  "customers",
  "orders",
  "product_batches",
  "stock_movements",
  "price_history",
  "register_shifts",
  // Refunds. Their absence here meant every return processed on a phone was
  // marked failed and never reached the books — the goods went back on the
  // shelf and the money left the drawer, with nothing on the server to show it.
  "returns",
  // Settlements against a customer's balance.
  "payments",
]);

export type SyncOutcome = {
  ok: boolean;
  pushed: number;
  conflicts: number;
  pulled: number;
  reason?: string;
};

type PushResult = {
  operation_id: string;
  status: "applied" | "duplicate" | "conflict" | "failed";
  record_id: string | null;
  reason?: string;
};

/** Re-exported so existing callers keep working; the id itself lives in one place. */
export { getDeviceId };

/**
 * Tell the server this device exists. Idempotent, both ends.
 *
 * It was written and never called, so no till had ever registered. That is not
 * only a missing row: the pull sends device_id so the server can withhold the
 * till's own writes from its own changefeed, and an unknown device defeats
 * that. A till then pulled back everything it had just pushed — wasted work,
 * and the way one page came to mention a record twice, which is what the
 * de-duplication above now absorbs.
 *
 * Attempted once per process, before the first push, and never allowed to stop
 * a sync: a shop whose registration call fails must still be able to send its
 * takings.
 */
let registration: Promise<void> | null = null;

export async function registerDevice(): Promise<void> {
  await api.post("/api/sync/devices", {
    device_id: await getDeviceId(),
    platform: "mobile",
    terminal_label: await storage.getItem("omnipos_terminal_label"),
  });
}

function ensureDeviceRegistered(): Promise<void> {
  registration ??= registerDevice().catch(() => {
    // Retried on the next sync rather than here. The server may simply be
    // unreachable, which is the condition this app is built to keep working in.
    registration = null;
  });

  return registration;
}

/**
 * Push, then pull. Push first so a sale made seconds ago is on the server before
 * we ask what changed — otherwise the pull can hand back a stale version of a
 * record this till just modified.
 */
export async function runLaravelSync(storeIdHint?: string | null): Promise<SyncOutcome> {
  const storeId = storeIdHint ?? (await storage.getItem(SYNC_STORAGE.activeStoreId));
  if (!storeId) return { ok: true, pushed: 0, conflicts: 0, pulled: 0 };

  /*
   * Only a total absence of network stops us trying.
   *
   * isInternetReachable is deliberately NOT consulted. It reports whether
   * Android could validate access to the public internet, and the server this
   * till talks to is very often not on the public internet: it is a machine on
   * the shop's own LAN, one hop away. A shop whose broadband is down, or behind
   * a captive portal, or whose firewall blocks Android's connectivity check,
   * has a perfectly reachable server and an unvalidated network — and this
   * returned "offline" without making a single request.
   *
   * That failed silently, which is the worst part: "offline" is treated as
   * unremarkable, so the badge stayed green, the home screen said all changes
   * were synced, and nothing reached the server for as long as it lasted.
   *
   * The same mistake, one layer down, is what the ApiError branch below exists
   * to prevent. Guessing at reachability before trying is how a till that
   * cannot sync comes to look exactly like one with nothing to send. If the
   * request fails, that branch says so accurately.
   */
  const net = await network.getState();
  if (net.isConnected === false) {
    return { ok: false, pushed: 0, conflicts: 0, pulled: 0, reason: "offline" };
  }

  try {
    // Before the push, so the operations it sends are attributed to a device
    // the server knows and can filter back out of this till's own changefeed.
    await ensureDeviceRegistered();

    const pushed = await pushQueue(storeId);
    await bootstrapProductsIfNeeded(storeId);
    const pulled = await pullChanges(storeId);

    const finishedAt = new Date().toISOString();
    await storage.setItem(LAST_SYNC_KEY, finishedAt);

    /*
     * Tell the sync store too. Only the Supabase engine ever did, so on a
     * Laravel build "Last synced" read "Not synced yet" for ever — including
     * immediately after a sync that had just worked. A cashier cannot tell a
     * till that is up to date from one that has never reached the server, and
     * the second is the one worth acting on.
     */
    useSyncStore.getState().markSynced(finishedAt);
    await refreshPendingSyncCount();

    return { ok: true, pushed: pushed.applied, conflicts: pushed.conflicts, pulled };
  } catch (error) {
    if (error instanceof ApiError && error.isUnreachable) {
      /*
       * The device has a network — that was checked above — and the request
       * still did not arrive. That is NOT the same as being offline, and
       * calling it so is what made a whole class of failure invisible on
       * hardware: a platform blocking cleartext HTTP, a firewall, a server
       * bound to 127.0.0.1, a wrong address. Every one of them showed an
       * Offline badge on a phone with four bars of Wi-Fi, and the till looked
       * like it was working.
       *
       * The underlying message is carried so the home screen can show what
       * actually happened rather than a word that is not true.
       */
      return {
        ok: false,
        pushed: 0,
        conflicts: 0,
        pulled: 0,
        reason: `Cannot reach the server: ${error.message}`,
      };
    }
    throw error;
  }
}

/**
 * The changefeed is not guaranteed to contain rows for a catalogue imported
 * before this device existed. Fetch the current catalogue once so a fresh till
 * does not authenticate successfully and then open with an empty inventory.
 */
async function bootstrapProductsIfNeeded(storeId: string): Promise<void> {
  const cursorKey = `${CURSOR_KEY}:${storeId}`;
  const existing = await database
    .get<Product>("products")
    .query(Q.where("store_id", storeId), Q.take(1))
    .fetch();
  if (existing.length > 0) return;

  // A cursor can survive a database reset or backend migration. The local
  // catalogue is the condition that matters: an empty table must be rebuilt
  // even when this device has synced the store before.
  if (await storage.getItem(cursorKey)) return;

  for (let page = 1; ; page += 1) {
    const response = await api.get<{
      data: Record<string, unknown>[];
      meta?: { last_page?: number };
    }>("/api/products", { per_page: 200, page });

    const changes = (response.data ?? []).map((product) => ({
      entity: "products",
      action: "upsert",
      record_id: str(product.id, ""),
      payload: product,
    }));

    if (changes.length > 0) await applyChanges(storeId, changes);
    if (!response.meta?.last_page || page >= response.meta.last_page) break;
  }
}

async function pushQueue(storeId: string): Promise<{ applied: number; conflicts: number }> {
  let applied = 0;
  let conflicts = 0;

  for (;;) {
    const batch = await database
      .get<SyncQueueItem>("sync_queue")
      .query(
        Q.where("store_id", storeId),
        Q.where("status", "pending"),
        Q.where("attempts", Q.lt(MAX_ATTEMPTS)),
        Q.take(PUSH_BATCH),
      )
      .fetch();

    if (batch.length === 0) break;

    const operations = batch
      .filter((row) => SUPPORTED.has(row.entity))
      .map((row) => ({
        // The row's own id, never regenerated. See the note at the top.
        operation_id: row.id,
        entity: row.entity,
        action: row.operation === "delete" ? "delete" : "upsert",
        record_id: row.recordId ?? row.id,
        payload: safeParse(row.payload),
      }));

    // Rows for entities this server does not accept would otherwise be retried
    // for ever, blocking the queue behind them.
    const unsupported = batch.filter((row) => !SUPPORTED.has(row.entity));
    if (unsupported.length > 0) {
      await database.write(async () => {
        const ops = unsupported.map((row) =>
          row.prepareUpdate((r) => {
            r.status = "failed";
            r.lastError = `Entity "${r.entity}" is not accepted by this server.`;
          }),
        );
        await database.batch(...ops);
      });
    }

    if (operations.length === 0) {
      if (batch.length < PUSH_BATCH) break;
      continue;
    }

    const response = await api.post<{ results: PushResult[] }>("/api/sync/push", {
      device_id: await getDeviceId(),
      operations,
    });

    const byId = new Map((response.results ?? []).map((r) => [r.operation_id, r]));

    await database.write(async () => {
      const ops: Model[] = [];

      for (const row of batch) {
        const result = byId.get(row.id);
        if (!result) continue;

        // A duplicate is a success: the server already has this write, which is
        // exactly what a retry after a dropped response looks like.
        if (result.status === "applied" || result.status === "duplicate") {
          ops.push(row.prepareDestroyPermanently());
          applied += 1;
          continue;
        }

        if (result.status === "conflict") {
          // Kept, not discarded. A rejected sale needs a person to look at it.
          ops.push(
            row.prepareUpdate((r) => {
              r.status = "conflict";
              r.lastError = result.reason ?? "Rejected by the server.";
            }),
          );
          conflicts += 1;
          continue;
        }

        ops.push(
          row.prepareUpdate((r) => {
            r.attempts = r.attempts + 1;
            r.lastError = result.reason ?? "Failed.";
          }),
        );
      }

      if (ops.length > 0) {
        await database.batch(...ops);
      }
    });

    if (batch.length < PUSH_BATCH) break;
  }

  return { applied, conflicts };
}

/**
 * Apply changes after the stored cursor.
 *
 * The cursor is the server's monotonic sequence, not a timestamp: timestamps are
 * unsafe across devices whose clocks disagree, and two changes written in the
 * same millisecond can straddle a boundary with one lost for ever.
 */
async function pullChanges(storeId: string): Promise<number> {
  const deviceId = await getDeviceId();
  const key = `${CURSOR_KEY}:${storeId}`;

  let cursor = Number.parseInt((await storage.getItem(key)) ?? "0", 10) || 0;
  let total = 0;

  for (;;) {
    const page = await api.get<{
      cursor: number;
      has_more: boolean;
      changes: Array<{
        entity: string;
        action: string;
        record_id: string;
        payload: Record<string, unknown>;
      }>;
    }>("/api/sync/pull", { cursor, limit: PULL_LIMIT, device_id: deviceId });

    if (!page.changes?.length) {
      // Still advance: the server filters out this device's own changes.
      if (page.cursor > cursor) await storage.setItem(key, String(page.cursor));
      break;
    }

    await applyChanges(storeId, page.changes);

    total += page.changes.length;
    cursor = page.cursor;
    await storage.setItem(key, String(cursor));

    if (!page.has_more) break;
  }

  return total;
}

/**
 * One change per record, the newest.
 *
 * A changefeed carries a row per write, so a product edited twice arrives
 * twice. The code below decides create-or-update from a map of what the
 * database already holds, built once before the loop — so a repeated record
 * took the create path on every occurrence and the batch contained two inserts
 * for one primary key:
 *
 *   SQLiteConstraintException: UNIQUE constraint failed: products.id
 *
 * That killed the whole pull, so nothing synced and the till reported "Not
 * synced yet" for ever while quietly retrying the same doomed batch.
 *
 * Keeping only the last is also what the records mean: the feed is ordered by
 * sequence, so the newest change is the current state and replaying the older
 * ones would only overwrite it with history.
 */
function latestPerRecord<T extends { record_id: string }>(list: T[]): T[] {
  const byId = new Map<string, T>();
  for (const change of list) {
    byId.set(change.record_id, change);
  }
  return [...byId.values()];
}

export async function applyChanges(
  storeId: string,
  changes: Array<{ entity: string; action: string; record_id: string; payload: Record<string, unknown> }>,
): Promise<void> {
  const productChanges = latestPerRecord(changes.filter((c) => c.entity === "products"));
  const customerChanges = latestPerRecord(changes.filter((c) => c.entity === "customers"));

  const productIds = productChanges.map((c) => c.record_id);
  const customerIds = customerChanges.map((c) => c.record_id);

  const productsCollection = database.get<Product>("products");
  const customersCollection = database.get<Customer>("customers");

  // Query existing records outside database.write to avoid adapter queue deadlock
  const existingProducts = productIds.length
    ? await productsCollection.query(Q.where("id", Q.oneOf(productIds))).fetch()
    : [];
  const existingCustomers = customerIds.length
    ? await customersCollection.query(Q.where("id", Q.oneOf(customerIds))).fetch()
    : [];

  const productMap = new Map(existingProducts.map((p) => [p.id, p]));
  const customerMap = new Map(existingCustomers.map((c) => [c.id, c]));

  await database.write(async () => {
    const operations: Model[] = [];

    for (const change of productChanges) {
      const current = productMap.get(change.record_id);

      if (change.action === "delete") {
        if (current) operations.push(current.prepareDestroyPermanently());
        continue;
      }

      const p = change.payload;
      if (current?.dirty) continue;

      if (current) {
        operations.push(
          current.prepareUpdate((r) => {
            r.name = str(p.name, r.name);
            r.sku = str(p.sku, r.sku);
            r.barcode = p.barcode ? String(p.barcode) : undefined;
            r.stock = num(p.stock, r.stock);
            r.sellPrice = num(p.price, r.sellPrice);
            r.costPrice = p.cost_price == null ? undefined : num(p.cost_price, 0);
            r.reorderLevel = num(p.reorder_level, r.reorderLevel);
            r.imageUrl = p.image_url ? String(p.image_url) : undefined;
            r.updatedAt = Date.now();
            r.dirty = false;
          }),
        );
      } else {
        operations.push(
          productsCollection.prepareCreate((r) => {
            r._raw.id = change.record_id;
            r.storeId = storeId;
            r.remoteId = change.record_id;
            r.name = str(p.name, "");
            r.sku = str(p.sku, "");
            r.barcode = p.barcode ? String(p.barcode) : undefined;
            r.stock = num(p.stock, 0);
            r.sellPrice = num(p.price, 0);
            r.costPrice = p.cost_price == null ? undefined : num(p.cost_price, 0);
            r.reorderLevel = num(p.reorder_level, 5);
            r.imageUrl = p.image_url ? String(p.image_url) : undefined;
            r.updatedAt = Date.now();
            r.dirty = false;
          }),
        );
      }
    }

    for (const change of customerChanges) {
      const current = customerMap.get(change.record_id);

      if (change.action === "delete") {
        if (current) operations.push(current.prepareDestroyPermanently());
        continue;
      }

      const c = change.payload;
      if (current?.dirty) continue;

      if (current) {
        operations.push(
          current.prepareUpdate((r) => {
            r.name = str(c.name, r.name);
            r.phone = c.phone ? String(c.phone) : undefined;
            r.email = c.email ? String(c.email) : undefined;
            r.totalSpend = num(c.total_spend, r.totalSpend);
            r.outstandingBalance = num(c.outstanding_balance, r.outstandingBalance);
            r.updatedAt = Date.now();
            r.dirty = false;
          }),
        );
      } else {
        operations.push(
          customersCollection.prepareCreate((r) => {
            r._raw.id = change.record_id;
            r.storeId = storeId;
            r.remoteId = change.record_id;
            r.name = str(c.name, "");
            r.phone = c.phone ? String(c.phone) : undefined;
            r.email = c.email ? String(c.email) : undefined;
            r.totalSpend = num(c.total_spend, 0);
            r.outstandingBalance = num(c.outstanding_balance, 0);
            r.updatedAt = Date.now();
            r.dirty = false;
          }),
        );
      }
    }

    if (operations.length > 0) {
      await database.batch(...operations);
    }
  });
}

function str(value: unknown, fallback: string): string {
  return value === null || value === undefined ? fallback : String(value);
}

function num(value: unknown, fallback: number | undefined): number {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return Number.isFinite(fallback as number) ? (fallback as number) : 0;
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function lastSyncedAt(): Promise<string | null> {
  return storage.getItem(LAST_SYNC_KEY);
}

/** Conflicts awaiting a decision on this device. */
export async function pendingConflicts(storeId: string): Promise<SyncQueueItem[]> {
  return database
    .get<SyncQueueItem>("sync_queue")
    .query(Q.where("store_id", storeId), Q.where("status", "conflict"))
    .fetch();
}
