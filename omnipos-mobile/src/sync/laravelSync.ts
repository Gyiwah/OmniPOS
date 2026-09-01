import { Q } from "@nozbe/watermelondb";

import { api, ApiError } from "@/src/core/api/client";
import { uuidv7 } from "@/src/core/ids";
import { network, storage } from "@/src/core/platform";
import { database } from "@/src/database";
import type Customer from "@/src/database/models/Customer";
import type Product from "@/src/database/models/Product";
import type SyncQueueItem from "@/src/database/models/SyncQueueItem";
import { SYNC_STORAGE } from "./keys";
import { refreshPendingSyncCount } from "./syncCounters";

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
const DEVICE_KEY = "omnipos_laravel_device_id";
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

/** Stable per-installation identity, so the server can attribute operations. */
export async function getDeviceId(): Promise<string> {
  let id = await storage.getItem(DEVICE_KEY);
  if (!id) {
    id = uuidv7();
    await storage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export async function registerDevice(): Promise<void> {
  await api.post("/api/sync/devices", {
    device_id: await getDeviceId(),
    platform: "mobile",
    terminal_label: await storage.getItem("omnipos_terminal_label"),
  });
}

/**
 * Push, then pull. Push first so a sale made seconds ago is on the server before
 * we ask what changed — otherwise the pull can hand back a stale version of a
 * record this till just modified.
 */
export async function runLaravelSync(storeIdHint?: string | null): Promise<SyncOutcome> {
  const storeId = storeIdHint ?? (await storage.getItem(SYNC_STORAGE.activeStoreId));
  if (!storeId) return { ok: true, pushed: 0, conflicts: 0, pulled: 0 };

  const net = await network.getState();
  if (net.isConnected === false || net.isInternetReachable === false) {
    return { ok: false, pushed: 0, conflicts: 0, pulled: 0, reason: "offline" };
  }

  try {
    const pushed = await pushQueue(storeId);
    const pulled = await pullChanges(storeId);

    await storage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    await refreshPendingSyncCount();

    return { ok: true, pushed: pushed.applied, conflicts: pushed.conflicts, pulled };
  } catch (error) {
    if (error instanceof ApiError && error.isUnreachable) {
      return { ok: false, pushed: 0, conflicts: 0, pulled: 0, reason: "offline" };
    }
    throw error;
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
        for (const row of unsupported) {
          await row.update((r) => {
            r.status = "failed";
            r.lastError = `Entity "${r.entity}" is not accepted by this server.`;
          });
        }
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
      for (const row of batch) {
        const result = byId.get(row.id);
        if (!result) continue;

        // A duplicate is a success: the server already has this write, which is
        // exactly what a retry after a dropped response looks like.
        if (result.status === "applied" || result.status === "duplicate") {
          await row.destroyPermanently();
          applied += 1;
          continue;
        }

        if (result.status === "conflict") {
          // Kept, not discarded. A rejected sale needs a person to look at it.
          await row.update((r) => {
            r.status = "conflict";
            r.lastError = result.reason ?? "Rejected by the server.";
          });
          conflicts += 1;
          continue;
        }

        await row.update((r) => {
          r.attempts = r.attempts + 1;
          r.lastError = result.reason ?? "Failed.";
        });
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

export async function applyChanges(
  storeId: string,
  changes: Array<{ entity: string; action: string; record_id: string; payload: Record<string, unknown> }>,
): Promise<void> {
  await database.write(async () => {
    for (const change of changes) {
      if (change.entity === "products") await applyProduct(storeId, change);
      else if (change.entity === "customers") await applyCustomer(storeId, change);
      // Entities the till does not keep locally are ignored rather than treated
      // as an error.
    }
  });
}

async function applyProduct(
  storeId: string,
  change: { action: string; record_id: string; payload: Record<string, unknown> },
): Promise<void> {
  const collection = database.get<Product>("products");
  const existing = await collection.query(Q.where("id", change.record_id)).fetch();
  const current = existing[0];

  if (change.action === "delete") {
    if (current) await current.destroyPermanently();
    return;
  }

  const p = change.payload;

  // A local edit not yet pushed outranks the server's copy; overwriting it
  // would throw away work the user has already done.
  if (current?.dirty) return;

  if (current) {
    await current.update((r) => {
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
    });
    return;
  }

  await collection.create((r) => {
    // The server's id becomes the local id: one identity everywhere.
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
  });
}

async function applyCustomer(
  storeId: string,
  change: { action: string; record_id: string; payload: Record<string, unknown> },
): Promise<void> {
  const collection = database.get<Customer>("customers");
  const existing = await collection.query(Q.where("id", change.record_id)).fetch();
  const current = existing[0];

  if (change.action === "delete") {
    if (current) await current.destroyPermanently();
    return;
  }

  const c = change.payload;
  if (current?.dirty) return;

  if (current) {
    await current.update((r) => {
      r.name = str(c.name, r.name);
      r.phone = c.phone ? String(c.phone) : undefined;
      r.email = c.email ? String(c.email) : undefined;
      // Balances are server-derived; the client reads them and never writes them.
      r.totalSpend = num(c.total_spend, r.totalSpend);
      r.outstandingBalance = num(c.outstanding_balance, r.outstandingBalance);
      r.updatedAt = Date.now();
      r.dirty = false;
    });
    return;
  }

  await collection.create((r) => {
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
