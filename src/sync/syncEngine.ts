import { Q } from "@nozbe/watermelondb";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
} from "./productRow";
import { refreshPendingSyncCount } from "./syncCounters";

import { buildOrderRowForSupabase, type OrderInsertPayload } from "./orderRow";
import { buildCustomerRowForSupabase, type CustomerUpsertPayload } from "./customerRow";
import type Order from "@/src/database/models/Order";
import type Customer from "@/src/database/models/Customer";

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

async function ensureSupabaseSession(): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  if (!data.session) {
    throw new Error("Not signed in to Supabase. Sign in again before syncing.");
  }
}

/** Push outbound queue + pull Postgres products & customers into SQLite */
export async function runSyncCycle(storeIdHint?: string | null): Promise<SyncCycleResult> {
  const fromStorage = await AsyncStorage.getItem(SYNC_STORAGE.activeStoreId);
  const storeId = storeIdHint ?? fromStorage ?? null;
  if (!storeId) {
    return { ok: true, pushed: 0, failed: 0 };
  }

  useSyncStore.getState().setSyncStatus("running");
  useSyncStore.getState().setSyncing(true);

  let flushResult: SyncCycleResult = { ok: true, pushed: 0, failed: 0 };

  try {
    await ensureSupabaseSession();
    const pRes = await flushProductQueue(storeId);
    const oRes = await flushOrderQueue(storeId);
    const cRes = await flushCustomerQueue(storeId);
    
    flushResult = {
      ok: pRes.ok && oRes.ok && cRes.ok,
      pushed: pRes.pushed + oRes.pushed + cRes.pushed,
      failed: pRes.failed + oRes.failed + cRes.failed,
      lastError: pRes.lastError || oRes.lastError || cRes.lastError,
    };

    await pullProducts(storeId);
    await pullCustomers(storeId);
    useSyncStore.getState().markSynced(new Date().toISOString());
    useSyncStore.getState().setSyncStatus(flushResult.ok ? "idle" : "error");
    if (!flushResult.ok && flushResult.lastError) {
      useSyncStore.getState().setLastError(flushResult.lastError);
    }
    await AsyncStorage.setItem(SYNC_STORAGE.activeStoreId, storeId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync failed";
    flushResult = { ok: false, pushed: flushResult.pushed, failed: flushResult.failed + 1, lastError: message };
    useSyncStore.getState().setSyncStatus("error");
    useSyncStore.getState().setLastError(message);
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

  const { data, error } = await supabase
    .from("products")
    .upsert(row, { onConflict: "store_id,sku" })
    .select("id");

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
          if (__DEV__) {
            const message = imageError instanceof Error ? imageError.message : "image upload failed";
            // eslint-disable-next-line no-console -- operator-facing sync diagnostics
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
      const message = e instanceof Error ? e.message : "sync failed";
      lastError = message;
      failed += 1;
      if (__DEV__) {
        // eslint-disable-next-line no-console -- operator-facing sync diagnostics
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
  const cursor = useFullPull ? null : await AsyncStorage.getItem(cursorKey);

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
      const match = await productsCol.query(Q.where("store_id", row.store_id), Q.where("sku", row.sku)).fetch();

      const found = match[0];
      if (found) {
        await found.update((rec) => {
          rec.remoteId = row.id;
          rec.name = row.name;
          rec.stock = row.stock;
          rec.sellPrice = Number(row.price);
          rec.costPrice = row.cost_price == null ? undefined : Number(row.cost_price);
          rec.barcode = row.barcode ?? undefined;
          rec.imageUrl = row.image_url ?? undefined;
          rec.updatedAt = resolvedTs;
          rec.dirty = false;
        });
      } else {
        await productsCol.create((rec) => {
          rec._raw.id = row.id;
          rec.storeId = row.store_id;
          rec.remoteId = row.id;
          rec.name = row.name;
          rec.sku = row.sku;
          rec.stock = row.stock;
          rec.sellPrice = Number(row.price);
          rec.updatedAt = resolvedTs;
          rec.dirty = false;
          rec.costPrice = row.cost_price == null ? undefined : Number(row.cost_price);
          rec.barcode = row.barcode ?? undefined;
          rec.imageUrl = row.image_url ?? undefined;
        });
      }
    }
  });

  const newest = rows.reduce((m, row) => (row.updated_at > m ? row.updated_at : m), rows[0].updated_at);
  await AsyncStorage.setItem(cursorKey, newest);
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
      if (item.operation === "upsert" || item.operation === "insert") {
        const payload = JSON.parse(item.payload) as OrderInsertPayload;
        const row = buildOrderRowForSupabase(payload);

        const { data: inserted, error: orderErr } = await supabase
          .from("orders")
          .upsert(row, { onConflict: "store_id,order_number" })
          .select("id")
          .single();

        if (orderErr) throw new Error(orderErr.message);
        const orderId = inserted?.id ?? payload.id;

        if (orderId && Array.isArray(payload.items) && payload.items.length > 0) {
          const linesPayload = payload.items.map((line) => ({
            order_id: orderId,
            store_id: storeId,
            product_id: line.product_id ?? null,
            sku: line.sku ?? null,
            barcode: line.barcode ?? null,
            product_name: line.product_name,
            unit_price: line.unit_price,
            quantity: line.quantity,
            line_total: line.line_total,
          }));

          const { error: lineErr } = await supabase.from("order_items").insert(linesPayload);
          if (lineErr && !lineErr.message.toLowerCase().includes("order_items")) {
            // ignore duplicate line errors if already inserted
            if (__DEV__) console.warn(`[OmniPOS] order_items sync notice: ${lineErr.message}`);
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

        const { data: inserted, error: custErr } = await supabase
          .from("customers")
          .upsert(row)
          .select("id")
          .single();

        if (custErr) throw new Error(custErr.message);
        const remoteId = inserted?.id ?? payload.id;

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
  const cursorKey = `omnipos:cursor:customers:${storeId}`;
  const localCount = await database.get<Customer>("customers").query(Q.where("store_id", storeId)).fetchCount();
  const useFullPull = localCount === 0;
  const cursor = useFullPull ? null : await AsyncStorage.getItem(cursorKey);

  let qb = supabase.from("customers").select("*").eq("store_id", storeId);
  if (cursor) {
    qb = qb.gte("updated_at", cursor);
  }
  const { data, error } = await qb;
  if (error) return; // fallback silently if table not deployed yet

  const rows = data as RemoteCustomer[] | null;
  if (!rows?.length) return;

  await database.write(async () => {
    const custCol = database.get<Customer>("customers");
    for (const row of rows) {
      const ts = Date.parse(row.updated_at);
      const resolvedTs = Number.isFinite(ts) ? ts : Date.now();
      const match = await custCol.query(Q.where("store_id", row.store_id), Q.where("name", row.name)).fetch();

      const found = match[0];
      if (found) {
        await found.update((rec) => {
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
      } else {
        await custCol.create((rec) => {
          rec._raw.id = row.id;
          rec.storeId = row.store_id;
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

  const newest = rows.reduce((m, row) => (row.updated_at > m ? row.updated_at : m), rows[0].updated_at);
  await AsyncStorage.setItem(cursorKey, newest);
}
