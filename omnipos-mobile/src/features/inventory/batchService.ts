import { uuidv7 } from "@/src/core/ids";
import { Q } from "@nozbe/watermelondb";

import { database } from "@/src/database";
import type ProductBatch from "@/src/database/models/ProductBatch";
import { enqueueChange } from "@/src/sync/enqueue";

export * from "./expiryUtils";
import { calculateExpiryStatus, type ExpiryInfo, type ExpiryStatus } from "./expiryUtils";

export async function createProductBatch(params: {
  storeId: string;
  productId: string;
  batchNumber: string;
  quantity: number;
  costPrice?: number;
  expiryDate?: string;
}): Promise<ProductBatch> {
  const batchId = uuidv7();
  const now = Date.now();

  let batchRecord: ProductBatch | null = null;
  await database.write(async () => {
    batchRecord = await database.get<ProductBatch>("product_batches").create((r) => {
      r._raw.id = batchId;
      r.storeId = params.storeId;
      r.remoteId = batchId;
      r.productId = params.productId;
      r.batchNumber = params.batchNumber.trim();
      r.quantity = params.quantity;
      r.costPrice = params.costPrice;
      r.expiryDate = params.expiryDate ? params.expiryDate.trim() : undefined;
      r.createdAt = now;
      r.updatedAt = now;
      r.dirty = true;
    });
  });

  await enqueueChange({
    storeId: params.storeId,
    entity: "product_batches",
    operation: "upsert",
    recordId: batchId,
    remoteId: batchId,
    payload: {
      id: batchId,
      store_id: params.storeId,
      product_id: params.productId,
      batch_number: params.batchNumber.trim(),
      quantity: params.quantity,
      cost_price: params.costPrice ?? null,
      expiry_date: params.expiryDate ? params.expiryDate.trim() : null,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    },
  });

  return batchRecord!;
}

export async function getProductBatches(
  storeId: string,
  productId: string,
): Promise<ProductBatch[]> {
  try {
    return await database
      .get<ProductBatch>("product_batches")
      .query(
        Q.where("store_id", storeId),
        Q.where("product_id", productId),
        Q.sortBy("created_at", Q.desc),
      )
      .fetch();
  } catch {
    return [];
  }
}

export async function getAllStoreBatches(storeId: string): Promise<ProductBatch[]> {
  try {
    return await database
      .get<ProductBatch>("product_batches")
      .query(Q.where("store_id", storeId))
      .fetch();
  } catch {
    return [];
  }
}

export async function getExpiringBatchesSummary(
  storeId: string,
  thresholdDays: number = 30,
): Promise<{
  expiredCount: number;
  expiringSoonCount: number;
  expiredBatches: ProductBatch[];
  expiringSoonBatches: ProductBatch[];
}> {
  const batches = await getAllStoreBatches(storeId);
  const expiredBatches: ProductBatch[] = [];
  const expiringSoonBatches: ProductBatch[] = [];

  for (const b of batches) {
    if (!b.expiryDate || (b.quantity ?? 0) <= 0) continue;
    const info = calculateExpiryStatus(b.expiryDate, thresholdDays);
    if (info.status === "expired") {
      expiredBatches.push(b);
    } else if (info.status === "expiring_soon") {
      expiringSoonBatches.push(b);
    }
  }

  return {
    expiredCount: expiredBatches.length,
    expiringSoonCount: expiringSoonBatches.length,
    expiredBatches,
    expiringSoonBatches,
  };
}
