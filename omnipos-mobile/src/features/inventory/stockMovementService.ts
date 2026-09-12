import { uuidv7 } from "@/src/core/ids";
import { Q } from "@nozbe/watermelondb";

import { database } from "@/src/database";
import type Product from "@/src/database/models/Product";
import type ProductBatch from "@/src/database/models/ProductBatch";
import type StockMovement from "@/src/database/models/StockMovement";
import { enqueueChange } from "@/src/sync/enqueue";

export type StockMovementType =
  | "STOCK_IN"
  | "STOCK_OUT"
  | "SALE"
  | "RETURN"
  | "ADJUSTMENT"
  | "DAMAGE"
  | "EXPIRED"
  | "AUDIT";

export type StockOutReason =
  | "Damaged / Broken"
  | "Expired"
  | "Lost / Theft"
  | "Internal Use / Sample"
  | "Returned to Vendor"
  | "Inventory Count Correction"
  | "Other";

export async function recordStockMovement(params: {
  storeId: string;
  productId: string;
  batchId?: string;
  type: StockMovementType | string;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string;
  notes?: string;
  /**
   * What caused this movement, so the ledger can answer "which sale took this
   * unit". The server already reads both from the payload; the client simply
   * never sent them, so a stock take turned up decrements that could not be
   * tied back to a receipt.
   */
  sourceType?: string;
  sourceId?: string;
}): Promise<StockMovement> {
  const movementId = uuidv7();
  const now = Date.now();

  let record: StockMovement | null = null;
  await database.write(async () => {
    record = await database.get<StockMovement>("stock_movements").create((r) => {
      r._raw.id = movementId;
      r.storeId = params.storeId;
      r.remoteId = movementId;
      r.productId = params.productId;
      r.batchId = params.batchId;
      r.type = params.type;
      r.quantity = params.quantity;
      r.quantityBefore = params.quantityBefore;
      r.quantityAfter = params.quantityAfter;
      r.reason = params.reason;
      r.notes = params.notes;
      r.createdAt = now;
      r.dirty = true;
    });
  });

  await enqueueChange({
    storeId: params.storeId,
    entity: "stock_movements",
    operation: "insert",
    recordId: movementId,
    remoteId: movementId,
    payload: {
      id: movementId,
      store_id: params.storeId,
      product_id: params.productId,
      batch_id: params.batchId ?? null,
      type: params.type,
      quantity: params.quantity,
      quantity_before: params.quantityBefore,
      quantity_after: params.quantityAfter,
      reason: params.reason,
      notes: params.notes ?? null,
      source_type: params.sourceType ?? null,
      source_id: params.sourceId ?? null,
      created_at: new Date(now).toISOString(),
    },
  });

  return record!;
}

export async function performStockOut(params: {
  storeId: string;
  productId: string;
  quantity: number;
  reason: StockOutReason | string;
  batchId?: string;
  notes?: string;
}): Promise<{ success: boolean; newStock: number; error?: string }> {
  if (params.quantity <= 0) {
    return { success: false, newStock: 0, error: "Stock-out quantity must be greater than 0." };
  }

  try {
    const product = await database.get<Product>("products").find(params.productId);
    const currentStock = Number(product.stock ?? 0);

    if (params.quantity > currentStock) {
      return {
        success: false,
        newStock: currentStock,
        error: `Cannot remove ${params.quantity}. Only ${currentStock} available in stock.`,
      };
    }

    const nextStock = currentStock - params.quantity;
    const now = Date.now();

    let batchRecord: ProductBatch | null = null;
    if (params.batchId) {
      try {
        batchRecord = await database.get<ProductBatch>("product_batches").find(params.batchId);
      } catch {
        // batch record not found
      }
    }

    await database.write(async () => {
      await product.update((rec) => {
        rec.stock = nextStock;
        rec.updatedAt = now;
        rec.dirty = true;
      });

      if (batchRecord) {
        const currentBatchQty = Number(batchRecord.quantity ?? 0);
        const nextBatchQty = Math.max(0, currentBatchQty - params.quantity);
        await batchRecord.update((b) => {
          b.quantity = nextBatchQty;
          b.updatedAt = now;
          b.dirty = true;
        });
      }
    });

    // Enqueue product sync update
    await enqueueChange({
      storeId: params.storeId,
      entity: "products",
      operation: "upsert",
      recordId: product.id,
      remoteId: product.remoteId,
      payload: {
        id: product.remoteId ?? product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode ?? product.sku,
        stock: nextStock,
        price: Number(product.sellPrice ?? 0),
        cost_price: product.costPrice ?? null,
        image_url: product.imageUrl ?? null,
        is_active: true,
      },
    });

    // Enqueue batch update if adjusted
    if (batchRecord) {
      await enqueueChange({
        storeId: params.storeId,
        entity: "product_batches",
        operation: "upsert",
        recordId: batchRecord.id,
        remoteId: batchRecord.remoteId,
        payload: {
          id: batchRecord.remoteId ?? batchRecord.id,
          store_id: params.storeId,
          product_id: params.productId,
          batch_number: batchRecord.batchNumber,
          quantity: batchRecord.quantity,
          cost_price: batchRecord.costPrice ?? null,
          expiry_date: batchRecord.expiryDate ?? null,
          updated_at: new Date(now).toISOString(),
        },
      });
    }

    // Determine movement type based on reason
    let moveType: StockMovementType = "STOCK_OUT";
    const rLower = params.reason.toLowerCase();
    if (rLower.includes("damage")) moveType = "DAMAGE";
    else if (rLower.includes("expire")) moveType = "EXPIRED";
    else if (rLower.includes("adjust") || rLower.includes("correction")) moveType = "ADJUSTMENT";

    await recordStockMovement({
      storeId: params.storeId,
      productId: params.productId,
      batchId: params.batchId,
      type: moveType,
      quantity: -params.quantity,
      quantityBefore: currentStock,
      quantityAfter: nextStock,
      reason: params.reason,
      notes: params.notes,
    });

    return { success: true, newStock: nextStock };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to process stock-out";
    return { success: false, newStock: 0, error: message };
  }
}

export async function getProductStockMovements(
  storeId: string,
  productId: string,
): Promise<StockMovement[]> {
  try {
    return await database
      .get<StockMovement>("stock_movements")
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
