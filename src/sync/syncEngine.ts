import { Q } from "@nozbe/watermelondb";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type Product from "@/src/database/models/Product";
import type SyncQueueItem from "@/src/database/models/SyncQueueItem";
import { database } from "@/src/database";
import { supabase } from "@/src/services/supabase";
import { useSyncStore } from "@/src/store/syncStore";
import { SYNC_STORAGE } from "./keys";
import { refreshPendingSyncCount } from "./syncCounters";

type RemoteProduct = {
  id: string;
  store_id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: number;
  cost_price: number | null;
  stock: number;
  updated_at: string;
};

/** Push outbound queue + pull Postgres products into SQLite */
export async function runSyncCycle(storeIdHint?: string | null): Promise<void> {
  const fromStorage = await AsyncStorage.getItem(SYNC_STORAGE.activeStoreId);
  const storeId = storeIdHint ?? fromStorage ?? null;
  if (!storeId) return;

  useSyncStore.getState().setSyncStatus("running");
  useSyncStore.getState().setSyncing(true);

  try {
    await flushProductQueue(storeId);
    await pullProducts(storeId);
    useSyncStore.getState().markSynced(new Date().toISOString());
    useSyncStore.getState().setSyncStatus("idle");
    await AsyncStorage.setItem(SYNC_STORAGE.activeStoreId, storeId);
  } catch {
    useSyncStore.getState().setSyncStatus("error");
  } finally {
    useSyncStore.getState().setSyncing(false);
    await refreshPendingSyncCount();
  }
}

async function flushProductQueue(storeId: string): Promise<void> {
  const pending = await database
    .get<SyncQueueItem>("sync_queue")
    .query(Q.where("store_id", storeId), Q.where("status", "pending"))
    .fetch();

  for (const item of pending.slice(0, 40)) {
    try {
      if (item.entity === "products" && item.operation === "upsert") {
        const body = JSON.parse(item.payload) as {
          id?: string;
          name?: string;
          sku?: string;
          barcode?: string;
          sell_price?: number;
          price?: number;
          cost_price?: number;
          stock?: number;
        };
        const row: Record<string, unknown> = {
          store_id: storeId,
          name: body.name ?? "",
          sku: body.sku ?? "",
          barcode: body.barcode ?? null,
          price: Number(body.sell_price ?? body.price ?? 0),
          cost_price: body.cost_price == null ? null : Number(body.cost_price),
          stock: Number(body.stock ?? 0),
        };
        if (body.id) {
          row.id = body.id;
        }
        await supabase.from("products").upsert(row, { onConflict: "store_id,sku" });
      } else if (item.entity === "products" && item.operation === "delete") {
        const body = JSON.parse(item.payload) as {
          id?: string;
          remote_id?: string;
          sku?: string;
        };
        const remoteId = body.id ?? body.remote_id ?? item.remoteId;
        if (remoteId) {
          await supabase.from("products").delete().eq("store_id", storeId).eq("id", remoteId);
        } else if (body.sku) {
          await supabase.from("products").delete().eq("store_id", storeId).eq("sku", body.sku);
        }
      }

      await database.write(async () => {
        await item.update((record) => {
          record.status = "completed";
          record.lastError = undefined;
        });
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "sync failed";
      await database.write(async () => {
        await item.update((record) => {
          record.attempts = record.attempts + 1;
          record.lastError = message;
          record.status = record.attempts >= 10 ? "error" : "pending";
        });
      });
    }
  }
}

async function pullProducts(storeId: string): Promise<void> {
  const cursorKey = `${SYNC_STORAGE.productsCursorIso}:${storeId}`;
  const cursor = await AsyncStorage.getItem(cursorKey);

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
          rec.updatedAt = resolvedTs;
          rec.dirty = false;
        });
      } else {
        await productsCol.create((rec) => {
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
        });
      }
    }
  });

  const newest = rows.reduce((m, row) => (row.updated_at > m ? row.updated_at : m), rows[0].updated_at);
  await AsyncStorage.setItem(cursorKey, newest);
}
