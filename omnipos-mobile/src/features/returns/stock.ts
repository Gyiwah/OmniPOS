import { Q } from "@nozbe/watermelondb";

import { database } from "@/src/database";
import type Product from "@/src/database/models/Product";
import { supabase } from "@/src/services/supabase";
import { enqueueChange } from "@/src/sync/enqueue";
import type { ReturnLineInput } from "./types";

async function findLocalProduct(
  storeId: string,
  productId: string | null,
  sku: string | null,
): Promise<Product | null> {
  if (productId) {
    const byRemote = await database
      .get<Product>("products")
      .query(Q.where("store_id", storeId), Q.where("remote_id", productId))
      .fetch();
    if (byRemote[0]) return byRemote[0];
    try {
      const byId = await database.get<Product>("products").find(productId);
      if (byId.storeId === storeId) return byId;
    } catch {
      // not in local cache
    }
  }
  if (sku) {
    const bySku = await database
      .get<Product>("products")
      .query(Q.where("store_id", storeId), Q.where("sku", sku))
      .fetch();
    return bySku[0] ?? null;
  }
  return null;
}

/** Put returned units back into local + cloud inventory. */
export async function restoreStockForReturn(storeId: string, lines: ReturnLineInput[]): Promise<void> {
  const activeLines = lines.filter((line) => line.quantity > 0);
  if (activeLines.length === 0) return;

  const now = Date.now();
  const updatedProducts: Product[] = [];

  await database.write(async () => {
    for (const line of activeLines) {
      const product = await findLocalProduct(storeId, line.productId, line.sku);
      if (!product) continue;
      await product.update((rec) => {
        rec.stock = Number(rec.stock ?? 0) + line.quantity;
        rec.updatedAt = now;
        rec.dirty = true;
      });
      updatedProducts.push(product);
    }
  });

  for (const product of updatedProducts) {
    await enqueueChange({
      storeId,
      entity: "products",
      operation: "upsert",
      recordId: product.id,
      remoteId: product.remoteId,
      payload: {
        id: product.remoteId ?? product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode ?? product.sku,
        stock: product.stock,
        price: Number(product.sellPrice ?? 0),
        cost_price: product.costPrice ?? null,
        image_url: product.imageUrl ?? null,
        is_active: true,
      },
    });
  }

  for (const line of activeLines) {
    if (!line.productId) continue;
    const { data: remoteProduct, error: readError } = await supabase
      .from("products")
      .select("stock")
      .eq("store_id", storeId)
      .eq("id", line.productId)
      .maybeSingle();

    if (readError || !remoteProduct) continue;

    const nextRemoteStock = Number(remoteProduct.stock ?? 0) + line.quantity;
    const { error: updateError } = await supabase
      .from("products")
      .update({ stock: nextRemoteStock })
      .eq("store_id", storeId)
      .eq("id", line.productId);

    if (updateError) throw new Error(updateError.message);
  }
}
