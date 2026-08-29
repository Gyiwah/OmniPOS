import * as Crypto from "expo-crypto";
import { Q } from "@nozbe/watermelondb";

import { database } from "@/src/database";
import type PriceHistory from "@/src/database/models/PriceHistory";
import { enqueueChange } from "@/src/sync/enqueue";

export async function recordPriceChange(params: {
  storeId: string;
  productId: string;
  oldSellPrice: number;
  newSellPrice: number;
  oldCostPrice?: number;
  newCostPrice?: number;
  reason?: string;
}): Promise<PriceHistory | null> {
  // If price hasn't actually changed, no need to record
  if (
    params.oldSellPrice === params.newSellPrice &&
    params.oldCostPrice === params.newCostPrice
  ) {
    return null;
  }

  const historyId = Crypto.randomUUID();
  const now = Date.now();

  let record: PriceHistory | null = null;
  await database.write(async () => {
    record = await database.get<PriceHistory>("price_history").create((r) => {
      r._raw.id = historyId;
      r.storeId = params.storeId;
      r.remoteId = historyId;
      r.productId = params.productId;
      r.oldSellPrice = params.oldSellPrice;
      r.newSellPrice = params.newSellPrice;
      r.oldCostPrice = params.oldCostPrice;
      r.newCostPrice = params.newCostPrice;
      r.reason = params.reason ?? "Price Update";
      r.createdAt = now;
      r.dirty = true;
    });
  });

  await enqueueChange({
    storeId: params.storeId,
    entity: "price_history",
    operation: "insert",
    recordId: historyId,
    remoteId: historyId,
    payload: {
      id: historyId,
      store_id: params.storeId,
      product_id: params.productId,
      old_sell_price: params.oldSellPrice,
      new_sell_price: params.newSellPrice,
      old_cost_price: params.oldCostPrice ?? null,
      new_cost_price: params.newCostPrice ?? null,
      reason: params.reason ?? "Price Update",
      created_at: new Date(now).toISOString(),
    },
  });

  return record!;
}

export async function getProductPriceHistory(
  storeId: string,
  productId: string,
): Promise<PriceHistory[]> {
  try {
    return await database
      .get<PriceHistory>("price_history")
      .query(
        Q.where("store_id", storeId),
        Q.where("product_id", productId),
        Q.sortBy("created_at", Q.asc),
      )
      .fetch();
  } catch {
    return [];
  }
}
