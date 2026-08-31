import { Q } from "@nozbe/watermelondb";
import { network, storage } from "@/src/core/platform";

import type Product from "@/src/database/models/Product";
import type SyncQueueItem from "@/src/database/models/SyncQueueItem";
import { database } from "@/src/database";
import { supabase } from "@/src/services/supabase";
import { isLocalImageUri, uploadProductImageFromUri } from "@/src/services/storage";
import { useSyncStore } from "@/src/store/syncStore";
import { SYNC_STORAGE } from "./keys";
import {
  buildProductRowForSupabase,
  type ProductUpsertPayload,
  resolveProductIdForImage,
  storedImageRef,
  isUuid,
} from "./productRow";
import { refreshPendingSyncCount } from "./syncCounters";

import { buildOrderRowForSupabase, type OrderInsertPayload } from "./orderRow";
import { buildCustomerRowForSupabase, type CustomerUpsertPayload } from "./customerRow";
import type Order from "@/src/database/models/Order";
import type Customer from "@/src/database/models/Customer";
import type ProductBatch from "@/src/database/models/ProductBatch";
import type StockMovement from "@/src/database/models/StockMovement";
import type PriceHistory from "@/src/database/models/PriceHistory";

type RemoteProduct = {
  id: string;
  store_id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: number;
  cost_price: number | null;
  stock: number;
  image_url: string | null;
  tags: string[] | null;
  is_active: boolean;
  updated_at: string;
};

type RemoteCustomer = {
  id: string;
  store_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  total_spend: number;
  outstanding_balance: number;
  notes: string | null;
  updated_at: string;
};

export type SyncCycleResult = {
  ok: boolean;
  pushed: number;
  failed: number;
  lastError?: string;
};

function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes("network request failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("network error") ||
    msg.includes("timeout") ||
    msg.includes("abort") ||
    msg.includes("connection refused") ||
    msg.includes("network_error") ||
    msg.includes("typeerror: network")
  );
}

async function ensureSupabaseSession(): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Push outbound queue + pull Postgres products & customers into SQLite */
export async function runSyncCycle(storeIdHint?: string | null): Promise<SyncCycleResult> {
  const fromStorage = await storage.getItem(SYNC_STORAGE.activeStoreId);
  const storeId = storeIdHint ?? fromStorage ?? null;
  if (!storeId) {
    return { ok: true, pushed: 0, failed: 0 };
  }

  // Check network connectivity first before attempting remote requests
  try {
    const net = await network.getState();
    if (net.isConnected === false || net.isInternetReachable === false) {
      useSyncStore.getState().setSyncStatus("idle");
      return { ok: true, pushed: 0, failed: 0 };
    }
  } catch {
    // ignore netinfo errors
  }

  useSyncStore.getState().setSyncStatus("running");
  useSyncStore.getState().setSyncing(true);

  let flushResult: SyncCycleResult = { ok: true, pushed: 0, failed: 0 };

  try {
    const hasSession = await ensureSupabaseSession();
    if (!hasSession) {
      useSyncStore.getState().setSyncStatus("idle");
      return {
        ok: false,
        pushed: 0,
        failed: 0,
        lastError: "Not signed in to Supabase. Sign in to enable cloud sync.",
      };
    }
    const pRes = await flushProductQueue(storeId);
    const oRes = await flushOrderQueue(storeId);
    const cRes = await flushCustomerQueue(storeId);
    const bRes = await flushBatchQueue(storeId);
    const smRes = await flushStockMovementQueue(storeId);
    const phRes = await flushPriceHistoryQueue(storeId);
    
    flushResult = {
      ok: pRes.ok && oRes.ok && cRes.ok && bRes.ok && smRes.ok && phRes.ok,
      pushed: pRes.pushed + oRes.pushed + cRes.pushed + bRes.pushed + smRes.pushed + phRes.pushed,
      failed: pRes.failed + oRes.failed + cRes.failed + bRes.failed + smRes.failed + phRes.failed,
      lastError: pRes.lastError || oRes.lastError || cRes.lastError || bRes.lastError || smRes.lastError || phRes.lastError,
    };

    try {
      await pullProducts(storeId);
      await pullCustomers(storeId);
      await pullBatches(storeId);
    } catch (pullErr) {
      if (!isNetworkError(pullErr) && __DEV__) {
        console.warn("[OmniPOS] Cloud pull notice:", pullErr);
      }
    }

    useSyncStore.getState().markSynced(new Date().toISOString());
    useSyncStore.getState().setSyncStatus(flushResult.ok ? "idle" : "error");
    if (!flushResult.ok && flushResult.lastError) {
      useSyncStore.getState().setLastError(flushResult.lastError);
    }
    await storage.setItem(SYNC_STORAGE.activeStoreId, storeId);
  } catch (error) {
    if (isNetworkError(error)) {
      flushResult = { ok: true, pushed: flushResult.pushed, failed: 0, lastError: "Offline" };
      useSyncStore.getState().setSyncStatus("idle");
    } else {
      const message = error instanceof Error ? error.message : "sync failed";
      flushResult = { ok: false, pushed: flushResult.pushed, failed: flushResult.failed + 1, lastError: message };
      useSyncStore.getState().setSyncStatus("error");
      useSyncStore.getState().setLastError(message);
    }
  } finally {
    useSyncStore.getState().setSyncing(false);
    await refreshPendingSyncCount();
  }

  return flushResult;
}

async function upsertRemoteProduct(storeId: string, body: ProductUpsertPayload): Promise<string> {
  const row = buildProductRowForSupabase(storeId, {
    ...body,
    image_url: storedImageRef(body.image_url),
  });

  let { data, error } = await supabase
    .from("products")
    .upsert(row, { onConflict: "store_id,sku" })
    .select("id");

  // Fallback: If remote schema doesn't have expiry_date column yet, retry without expiry_date
  if (error && error.message.toLowerCase().includes("expiry_date")) {
    const fallbackRow = { ...row };
    delete fallbackRow.expiry_date;
    const retry = await supabase
      .from("products")
      .upsert(fallbackRow, { onConflict: "store_id,sku" })
      .select("id");
    data = retry.data;
    error = retry.error;
  }

  // Fallback: If remote schema doesn't have reorder_level column yet, retry without reorder_level
  if (error && error.message.toLowerCase().includes("reorder_level")) {
    const fallbackRow = { ...row };
    delete fallbackRow.expiry_date;
    delete fallbackRow.reorder_level;
    const retry = await supabase
      .from("products")
      .upsert(fallbackRow, { onConflict: "store_id,sku" })
      .select("id");
    data = retry.data;
    error = retry.error;
  }

  if (error) throw new Error(error.message);

  const remoteId = data?.[0]?.id ?? (typeof row.id === "string" ? row.id : undefined);
  if (!remoteId) {
    throw new Error("Product upsert succeeded but no id was returned.");
  }

  return remoteId;
}

async function syncProductImage(
  storeId: string,
  body: ProductUpsertPayload,
  recordId: string | undefined,
  remoteId: string,
): Promise<string | null> {
  const localUri = body.local_image_uri?.trim();
  if (!localUri || !isLocalImageUri(localUri)) {
    return storedImageRef(body.image_url);
  }

  const productId = resolveProductIdForImage(body, recordId) ?? remoteId;
  const imageRef = await uploadProductImageFromUri({
    storeId,
    productId,
    localUri,
    mimeType: body.local_image_mime,
  });

  const { error } = await supabase
    .from("products")
    .update({ image_url: imageRef })
    .eq("store_id", storeId)
    .eq("id", remoteId);

  if (error) throw new Error(error.message);
  return imageRef;
}

async function flushProductQueue(storeId: string): Promise<SyncCycleResult> {
  const pending = await database
    .get<SyncQueueItem>("sync_queue")
    .query(Q.where("store_id", storeId), Q.where("status", "pending"))
    .fetch();

  let pushed = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (const item of pending.slice(0, 40)) {
    try {
      if (item.entity === "products" && item.operation === "upsert") {
        const body = JSON.parse(item.payload) as ProductUpsertPayload;
        const remoteId = await upsertRemoteProduct(storeId, body);

        let imageRef = storedImageRef(body.image_url);
        try {
          const uploadedRef = await syncProductImage(storeId, body, item.recordId, remoteId);
          if (uploadedRef) {
            imageRef = uploadedRef;
          }
        } catch (imageError) {
          if (__DEV__ && !isNetworkError(imageError)) {
            const message = imageError instanceof Error ? imageError.message : "image upload failed";
            console.warn(`[OmniPOS] Product saved to cloud; image upload failed: ${message}`);
          }
        }

        if (item.recordId) {
          try {
            const local = await database.get<Product>("products").find(item.recordId);
            await database.write(async () => {
              await local.update((rec) => {
                rec.remoteId = remoteId;
                rec.dirty = false;
                if (imageRef) {
                  rec.imageUrl = imageRef;
                }
              });
            });
          } catch {
            // Local row may have been removed; cloud write still succeeded.
          }
        }
      } else if (item.entity === "products" && item.operation === "delete") {
        const body = JSON.parse(item.payload) as {
          id?: string;
          remote_id?: string;
          sku?: string;
        };
        const remoteId = body.id ?? body.remote_id ?? item.remoteId;
        if (remoteId) {
          const { error } = await supabase.from("products").delete().eq("store_id", storeId).eq("id", remoteId);
          if (error) throw new Error(error.message);
        } else if (body.sku) {
          const { error } = await supabase.from("products").delete().eq("store_id", storeId).eq("sku", body.sku);
          if (error) throw new Error(error.message);
        } else {
          throw new Error("Delete payload missing product id or sku");
        }
      }

      await database.write(async () => {
        await item.update((record) => {
          record.status = "completed";
          record.lastError = undefined;
        });
      });
      pushed += 1;
    } catch (e) {
      if (isNetworkError(e)) {
        // Device is offline: keep item pending and abort further remote requests
        return { ok: false, pushed, failed: 0, lastError: "Offline" };
      }
      const message = e instanceof Error ? e.message : "sync failed";
      lastError = message;
      failed += 1;
      if (__DEV__) {
        console.warn(`[OmniPOS] Sync queue item failed (${item.entity}/${item.operation}): ${message}`);
      }
      await database.write(async () => {
        await item.update((record) => {
          record.attempts = record.attempts + 1;
          record.lastError = message;
          record.status = record.attempts >= 10 ? "error" : "pending";
        });
      });
    }
  }

  return { ok: failed === 0, pushed, failed, lastError };
}

async function pullProducts(storeId: string): Promise<void> {
  const cursorKey = `${SYNC_STORAGE.productsCursorIso}:${storeId}`;
  const localCount = await database.get<Product>("products").query(Q.where("store_id", storeId)).fetchCount();
  const useFullPull = localCount === 0;
  const cursor = useFullPull ? null : await storage.getItem(cursorKey);

  let qb = supabase.from("products").select("*").eq("store_id", storeId);
  if (cursor) {
    qb = qb.gte("updated_at", cursor);
  }
  const { data, error } = await qb;
  if (error) throw error;

  const rows = data as RemoteProduct[] | null;
  if (!rows?.length) return;

  await database.write(async () => {
    const productsCol = database.get<Product>("products");
    for (const row of rows) {
      const ts = Date.parse(row.updated_at);
      const resolvedTs = Number.isFinite(ts) ? ts : Date.now();
      // Match on the server id first. Clients mint their own UUIDs, so a pulled
      // row and its local counterpart share one identity; the natural key is only
      // a fallback for legacy rows created before client-minted ids existed.
      const byId = await productsCol.query(Q.where("id", row.id)).fetch();
      const existing = byId.length
        ? byId
        : await productsCol.query(Q.where("store_id", storeId), Q.where("sku", row.sku)).fetch();

      const current = existing[0];
      if (current) {
        if (current.dirty) {
          continue;
        }
        await current.update((rec) => {
          rec.name = row.name;
          rec.barcode = row.barcode ?? undefined;
          rec.stock = row.stock;
          rec.sellPrice = row.price;
          rec.costPrice = row.cost_price ?? undefined;
          rec.imageUrl = row.image_url ?? undefined;
          rec.tags = row.tags?.join(", ") ?? undefined;
          rec.remoteId = row.id;
          rec.updatedAt = resolvedTs;
          rec.dirty = false;
        });
      } else {
        await productsCol.create((rec) => {
          // Adopt the server id as the local primary key so local id === server id.
          rec._raw.id = row.id;
          rec.storeId = storeId;
          rec.remoteId = row.id;
          rec.name = row.name;
          rec.sku = row.sku;
          rec.barcode = row.barcode ?? undefined;
          rec.stock = row.stock;
          rec.sellPrice = row.price;
          rec.costPrice = row.cost_price ?? undefined;
          rec.imageUrl = row.image_url ?? undefined;
          rec.tags = row.tags?.join(", ") ?? undefined;
          rec.reorderLevel = 5;
          rec.updatedAt = resolvedTs;
          rec.dirty = false;
        });
      }
    }
  });

  const latestUpdated = rows.reduce((latest, r) => {
    return !latest || r.updated_at > latest ? r.updated_at : latest;
  }, "");
  if (latestUpdated) {
    await storage.setItem(cursorKey, latestUpdated);
  }
}

async function flushOrderQueue(storeId: string): Promise<SyncCycleResult> {
  const pending = await database
    .get<SyncQueueItem>("sync_queue")
    .query(Q.where("store_id", storeId), Q.where("entity", "orders"), Q.where("status", "pending"))
    .fetch();

  let pushed = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (const item of pending.slice(0, 20)) {
    try {
      if (item.operation === "insert" || item.operation === "upsert") {
        const payload = JSON.parse(item.payload) as OrderInsertPayload;
        const row = buildOrderRowForSupabase({ ...payload, store_id: storeId });

        let orderId = payload.id;
        if (row.id) {
          const { data: inserted, error: ordErr } = await supabase
            .from("orders")
            .upsert(row, { onConflict: "id" })
            .select("id")
            .single();

          if (ordErr) throw new Error(ordErr.message);
          orderId = inserted?.id ?? payload.id;
        } else {
          const { data: inserted, error: ordErr } = await supabase
            .from("orders")
            .insert(row)
            .select("id")
            .single();

          if (ordErr) throw new Error(ordErr.message);
          orderId = inserted?.id;
        }

        const orderItems = payload.items || (payload as any).lines || [];
        if (orderItems.length > 0 && orderId) {
          const linesPayload = orderItems.map((line: any) => ({
            order_id: orderId,
            store_id: storeId,
            product_id: isUuid(line.productId || line.product_id) ? (line.productId || line.product_id) : null,
            product_name: line.name || line.product_name,
            sku: line.sku,
            barcode: line.barcode,
            unit_price: line.unitPrice ?? line.unit_price,
            quantity: line.quantity,
            line_total: line.lineTotal ?? line.line_total ?? (Number(line.unitPrice ?? line.unit_price ?? 0) * Number(line.quantity ?? 1)),
          }));

          const { error: lineErr } = await supabase.from("order_items").insert(linesPayload);
          if (lineErr && !lineErr.message.toLowerCase().includes("duplicate")) {
            if (__DEV__ && !isNetworkError(lineErr)) console.warn(`[OmniPOS] order_items sync notice: ${lineErr.message}`);
          }
        }

        if (item.recordId) {
          try {
            const localOrder = await database.get<Order>("orders").find(item.recordId);
            await database.write(async () => {
              await localOrder.update((rec) => {
                rec.remoteId = orderId;
                rec.dirty = false;
              });
            });
          } catch {
            // local record may be gone
          }
        }
      }

      await database.write(async () => {
        await item.update((record) => {
          record.status = "completed";
          record.lastError = undefined;
        });
      });
      pushed += 1;
    } catch (e) {
      if (isNetworkError(e)) {
        return { ok: false, pushed, failed: 0, lastError: "Offline" };
      }
      const message = e instanceof Error ? e.message : "order sync failed";
      lastError = message;
      failed += 1;
      await database.write(async () => {
        await item.update((record) => {
          record.attempts = record.attempts + 1;
          record.lastError = message;
          record.status = record.attempts >= 10 ? "error" : "pending";
        });
      });
    }
  }

  return { ok: failed === 0, pushed, failed, lastError };
}

async function flushCustomerQueue(storeId: string): Promise<SyncCycleResult> {
  const pending = await database
    .get<SyncQueueItem>("sync_queue")
    .query(Q.where("store_id", storeId), Q.where("entity", "customers"), Q.where("status", "pending"))
    .fetch();

  let pushed = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (const item of pending.slice(0, 20)) {
    try {
      if (item.operation === "upsert" || item.operation === "insert") {
        const payload = JSON.parse(item.payload) as CustomerUpsertPayload;
        const row = buildCustomerRowForSupabase(payload);

        let remoteId = payload.id;
        if (row.id) {
          const { data: inserted, error: custErr } = await supabase
            .from("customers")
            .upsert(row, { onConflict: "id" })
            .select("id")
            .single();

          if (custErr) throw new Error(custErr.message);
          remoteId = inserted?.id ?? payload.id;
        } else {
          const { data: inserted, error: custErr } = await supabase
            .from("customers")
            .insert(row)
            .select("id")
            .single();

          if (custErr) throw new Error(custErr.message);
          remoteId = inserted?.id;
        }

        if (item.recordId && remoteId) {
          try {
            const localCust = await database.get<Customer>("customers").find(item.recordId);
            await database.write(async () => {
              await localCust.update((rec) => {
                rec.remoteId = remoteId;
                rec.dirty = false;
              });
            });
          } catch {
            // ignore
          }
        }
      }

      await database.write(async () => {
        await item.update((record) => {
          record.status = "completed";
          record.lastError = undefined;
        });
      });
      pushed += 1;
    } catch (e) {
      if (isNetworkError(e)) {
        return { ok: false, pushed, failed: 0, lastError: "Offline" };
      }
      const message = e instanceof Error ? e.message : "customer sync failed";
      lastError = message;
      failed += 1;
      await database.write(async () => {
        await item.update((record) => {
          record.attempts = record.attempts + 1;
          record.lastError = message;
          record.status = record.attempts >= 10 ? "error" : "pending";
        });
      });
    }
  }

  return { ok: failed === 0, pushed, failed, lastError };
}

async function pullCustomers(storeId: string): Promise<void> {
  const cursorKey = `${SYNC_STORAGE.customersCursorIso}:${storeId}`;
  const localCount = await database.get<Customer>("customers").query(Q.where("store_id", storeId)).fetchCount();
  const useFullPull = localCount === 0;
  const cursor = useFullPull ? null : await storage.getItem(cursorKey);

  let qb = supabase.from("customers").select("*").eq("store_id", storeId);
  if (cursor) {
    qb = qb.gte("updated_at", cursor);
  }
  const { data, error } = await qb;
  if (error) throw error;

  const rows = data as RemoteCustomer[] | null;
  if (!rows?.length) return;

  await database.write(async () => {
    const custCol = database.get<Customer>("customers");
    for (const row of rows) {
      const ts = Date.parse(row.updated_at);
      const resolvedTs = Number.isFinite(ts) ? ts : Date.now();

      const existing = await custCol
        .query(
          Q.where("store_id", storeId),
          Q.or(
            Q.where("id", row.id),
            Q.where("remote_id", row.id),
            row.phone ? Q.where("phone", row.phone) : Q.where("id", row.id),
          ),
        )
        .fetch();

      const current = existing[0];
      if (current) {
        if (current.dirty) {
          continue;
        }
        await current.update((rec) => {
          rec.name = row.name;
          rec.phone = row.phone ?? undefined;
          rec.email = row.email ?? undefined;
          rec.totalSpend = Number(row.total_spend ?? 0);
          rec.outstandingBalance = Number(row.outstanding_balance ?? 0);
          rec.notes = row.notes ?? undefined;
          rec.remoteId = row.id;
          rec.updatedAt = resolvedTs;
          rec.dirty = false;
        });
      } else {
        await custCol.create((rec) => {
          rec._raw.id = row.id;
          rec.storeId = storeId;
          rec.remoteId = row.id;
          rec.name = row.name;
          rec.phone = row.phone ?? undefined;
          rec.email = row.email ?? undefined;
          rec.totalSpend = Number(row.total_spend ?? 0);
          rec.outstandingBalance = Number(row.outstanding_balance ?? 0);
          rec.notes = row.notes ?? undefined;
          rec.updatedAt = resolvedTs;
          rec.dirty = false;
        });
      }
    }
  });

  const latestUpdated = rows.reduce((latest, r) => {
    return !latest || r.updated_at > latest ? r.updated_at : latest;
  }, "");
  if (latestUpdated) {
    await storage.setItem(cursorKey, latestUpdated);
  }
}

async function resolveRemoteProductId(storeId: string, productIdOrLocalId: string): Promise<string> {
  if (isUuid(productIdOrLocalId)) return productIdOrLocalId;
  try {
    const product = await database.get<Product>("products").find(productIdOrLocalId);
    if (product?.remoteId && isUuid(product.remoteId)) {
      return product.remoteId;
    }
  } catch {
    // maybe it's already a remote ID
  }
  return productIdOrLocalId;
}

async function flushBatchQueue(storeId: string): Promise<SyncCycleResult> {
  const pending = await database
    .get<SyncQueueItem>("sync_queue")
    .query(Q.where("store_id", storeId), Q.where("entity", "product_batches"), Q.where("status", "pending"))
    .fetch();

  let pushed = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (const item of pending.slice(0, 30)) {
    try {
      if (item.operation === "upsert" || item.operation === "insert") {
        const payload = JSON.parse(item.payload) as {
          id?: string;
          store_id: string;
          product_id: string;
          batch_number: string;
          quantity: number;
          cost_price?: number | null;
          expiry_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };

        const resolvedProductId = await resolveRemoteProductId(storeId, payload.product_id);
        const batchRow: Record<string, unknown> = {
          store_id: storeId,
          product_id: resolvedProductId,
          batch_number: payload.batch_number,
          quantity: Number(payload.quantity ?? 0),
          cost_price: payload.cost_price != null ? Number(payload.cost_price) : null,
          expiry_date: payload.expiry_date ? String(payload.expiry_date).slice(0, 10) : null,
          updated_at: payload.updated_at ?? new Date().toISOString(),
        };

        if (payload.id && isUuid(payload.id)) {
          batchRow.id = payload.id;
        }

        const { data: inserted, error: batchErr } = await supabase
          .from("product_batches")
          .upsert(batchRow)
          .select("id")
          .single();

        if (batchErr) throw new Error(batchErr.message);
        const remoteId = inserted?.id ?? payload.id;

        if (item.recordId && remoteId) {
          try {
            const localBatch = await database.get<ProductBatch>("product_batches").find(item.recordId);
            await database.write(async () => {
              await localBatch.update((rec) => {
                rec.remoteId = remoteId;
                rec.dirty = false;
              });
            });
          } catch {
            // ignore
          }
        }
      } else if (item.operation === "delete") {
        const payload = JSON.parse(item.payload) as { id?: string };
        const remoteId = payload.id ?? item.remoteId;
        if (remoteId && isUuid(remoteId)) {
          const { error: delErr } = await supabase
            .from("product_batches")
            .delete()
            .eq("store_id", storeId)
            .eq("id", remoteId);
          if (delErr) throw new Error(delErr.message);
        }
      }

      await database.write(async () => {
        await item.update((record) => {
          record.status = "completed";
          record.lastError = undefined;
        });
      });
      pushed += 1;
    } catch (e) {
      if (isNetworkError(e)) {
        return { ok: false, pushed, failed: 0, lastError: "Offline" };
      }
      const message = e instanceof Error ? e.message : "batch sync failed";
      lastError = message;
      failed += 1;
      await database.write(async () => {
        await item.update((record) => {
          record.attempts = record.attempts + 1;
          record.lastError = message;
          record.status = record.attempts >= 10 ? "error" : "pending";
        });
      });
    }
  }

  return { ok: failed === 0, pushed, failed, lastError };
}

async function flushStockMovementQueue(storeId: string): Promise<SyncCycleResult> {
  const pending = await database
    .get<SyncQueueItem>("sync_queue")
    .query(Q.where("store_id", storeId), Q.where("entity", "stock_movements"), Q.where("status", "pending"))
    .fetch();

  let pushed = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (const item of pending.slice(0, 30)) {
    try {
      if (item.operation === "insert" || item.operation === "upsert") {
        const payload = JSON.parse(item.payload) as {
          id?: string;
          store_id: string;
          product_id: string;
          batch_id?: string | null;
          type: string;
          quantity: number;
          quantity_before?: number;
          quantity_after?: number;
          reason: string;
          notes?: string | null;
          created_at?: string;
        };

        const resolvedProductId = await resolveRemoteProductId(storeId, payload.product_id);
        const movementRow: Record<string, unknown> = {
          store_id: storeId,
          product_id: resolvedProductId,
          batch_id: payload.batch_id && isUuid(payload.batch_id) ? payload.batch_id : null,
          type: payload.type,
          quantity: Number(payload.quantity ?? 0),
          quantity_before: Number(payload.quantity_before ?? 0),
          quantity_after: Number(payload.quantity_after ?? 0),
          reason: payload.reason,
          notes: payload.notes ?? null,
          created_at: payload.created_at ?? new Date().toISOString(),
        };

        if (payload.id && isUuid(payload.id)) {
          movementRow.id = payload.id;
        }

        const { error: moveErr } = await supabase.from("stock_movements").insert(movementRow);
        if (moveErr && !moveErr.message.toLowerCase().includes("duplicate")) {
          throw new Error(moveErr.message);
        }
      }

      await database.write(async () => {
        await item.update((record) => {
          record.status = "completed";
          record.lastError = undefined;
        });
      });
      pushed += 1;
    } catch (e) {
      if (isNetworkError(e)) {
        return { ok: false, pushed, failed: 0, lastError: "Offline" };
      }
      const message = e instanceof Error ? e.message : "stock movement sync failed";
      lastError = message;
      failed += 1;
      await database.write(async () => {
        await item.update((record) => {
          record.attempts = record.attempts + 1;
          record.lastError = message;
          record.status = record.attempts >= 10 ? "error" : "pending";
        });
      });
    }
  }

  return { ok: failed === 0, pushed, failed, lastError };
}

async function flushPriceHistoryQueue(storeId: string): Promise<SyncCycleResult> {
  const pending = await database
    .get<SyncQueueItem>("sync_queue")
    .query(Q.where("store_id", storeId), Q.where("entity", "price_history"), Q.where("status", "pending"))
    .fetch();

  let pushed = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (const item of pending.slice(0, 30)) {
    try {
      if (item.operation === "insert" || item.operation === "upsert") {
        const payload = JSON.parse(item.payload) as {
          id?: string;
          store_id: string;
          product_id: string;
          old_sell_price: number;
          new_sell_price: number;
          old_cost_price?: number | null;
          new_cost_price?: number | null;
          reason?: string | null;
          created_at?: string;
        };

        const resolvedProductId = await resolveRemoteProductId(storeId, payload.product_id);
        const priceRow: Record<string, unknown> = {
          store_id: storeId,
          product_id: resolvedProductId,
          old_sell_price: Number(payload.old_sell_price ?? 0),
          new_sell_price: Number(payload.new_sell_price ?? 0),
          old_cost_price: payload.old_cost_price != null ? Number(payload.old_cost_price) : null,
          new_cost_price: payload.new_cost_price != null ? Number(payload.new_cost_price) : null,
          reason: payload.reason ?? "Price Update",
          created_at: payload.created_at ?? new Date().toISOString(),
        };

        if (payload.id && isUuid(payload.id)) {
          priceRow.id = payload.id;
        }

        const { error: priceErr } = await supabase.from("price_history").insert(priceRow);
        if (priceErr && !priceErr.message.toLowerCase().includes("duplicate")) {
          throw new Error(priceErr.message);
        }
      }

      await database.write(async () => {
        await item.update((record) => {
          record.status = "completed";
          record.lastError = undefined;
        });
      });
      pushed += 1;
    } catch (e) {
      if (isNetworkError(e)) {
        return { ok: false, pushed, failed: 0, lastError: "Offline" };
      }
      const message = e instanceof Error ? e.message : "price history sync failed";
      lastError = message;
      failed += 1;
      await database.write(async () => {
        await item.update((record) => {
          record.attempts = record.attempts + 1;
          record.lastError = message;
          record.status = record.attempts >= 10 ? "error" : "pending";
        });
      });
    }
  }

  return { ok: failed === 0, pushed, failed, lastError };
}

async function pullBatches(storeId: string): Promise<void> {
  const cursorKey = `${SYNC_STORAGE.batchesCursorIso}:${storeId}`;
  const localCount = await database.get<ProductBatch>("product_batches").query(Q.where("store_id", storeId)).fetchCount();
  const useFullPull = localCount === 0;
  const cursor = useFullPull ? null : await storage.getItem(cursorKey);

  let qb = supabase.from("product_batches").select("*").eq("store_id", storeId);
  if (cursor) {
    qb = qb.gte("updated_at", cursor);
  }
  const { data, error } = await qb;
  if (error) throw error;

  const rows = data as Array<{
    id: string;
    store_id: string;
    product_id: string;
    batch_number: string;
    quantity: number;
    cost_price: number | null;
    expiry_date: string | null;
    created_at: string;
    updated_at: string;
  }> | null;

  if (!rows?.length) return;

  await database.write(async () => {
    const batchesCol = database.get<ProductBatch>("product_batches");
    for (const row of rows) {
      const ts = Date.parse(row.updated_at);
      const resolvedTs = Number.isFinite(ts) ? ts : Date.now();

      // Server id first (see pullProducts); batch_number + product_id is the
      // legacy fallback and must not be allowed to miss into a duplicate insert.
      const byId = await batchesCol.query(Q.where("id", row.id)).fetch();
      const existing = byId.length
        ? byId
        : await batchesCol
            .query(
              Q.where("store_id", storeId),
              Q.where("batch_number", row.batch_number),
              Q.where("product_id", row.product_id),
            )
            .fetch();

      const current = existing[0];
      if (current) {
        if (current.dirty) continue;
        await current.update((rec) => {
          rec.quantity = row.quantity;
          rec.costPrice = row.cost_price ?? undefined;
          rec.expiryDate = row.expiry_date ?? undefined;
          rec.remoteId = row.id;
          rec.updatedAt = resolvedTs;
          rec.dirty = false;
        });
      } else {
        await batchesCol.create((rec) => {
          rec._raw.id = row.id;
          rec.storeId = storeId;
          rec.remoteId = row.id;
          rec.productId = row.product_id;
          rec.batchNumber = row.batch_number;
          rec.quantity = row.quantity;
          rec.costPrice = row.cost_price ?? undefined;
          rec.expiryDate = row.expiry_date ?? undefined;
          rec.createdAt = Date.parse(row.created_at) || Date.now();
          rec.updatedAt = resolvedTs;
          rec.dirty = false;
        });
      }
    }
  });

  const latestUpdated = rows.reduce((latest, r) => {
    return !latest || r.updated_at > latest ? r.updated_at : latest;
  }, "");
  if (latestUpdated) {
    await storage.setItem(cursorKey, latestUpdated);
  }
}
