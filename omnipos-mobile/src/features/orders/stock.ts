import { Q } from "@nozbe/watermelondb";

import { database } from "@/src/database";
import type Product from "@/src/database/models/Product";
import { recordStockMovement } from "@/src/features/inventory/stockMovementService";
import { supabase } from "@/src/services/supabase";
import { enqueueChange } from "@/src/sync/enqueue";
import type { DraftLine } from "@/src/store/orderDraftStore";
import { usingLaravel } from "@/src/core/api/config";

export type StockCheckLine = Pick<DraftLine, "id" | "name" | "quantity">;

export class InsufficientStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientStockError";
  }
}

export async function fetchStockByProductId(
  storeId: string,
  productIds: string[],
): Promise<Map<string, number>> {
  const uniqueIds = [...new Set(productIds)];
  if (uniqueIds.length === 0) return new Map();

  const rows = await database
    .get<Product>("products")
    .query(Q.where("store_id", storeId), Q.where("id", Q.oneOf(uniqueIds)))
    .fetch();

  return new Map(rows.map((row) => [row.id, Number(row.stock ?? 0)]));
}

export function validateCartQuantities(
  lines: StockCheckLine[],
  stockById: Map<string, number>,
): void {
  for (const line of lines) {
    const available = stockById.get(line.id) ?? 0;
    if (line.quantity > available) {
      throw new InsufficientStockError(
        available <= 0
          ? `"${line.name}" is out of stock.`
          : `"${line.name}" only has ${available} in stock (requested ${line.quantity}).`,
      );
    }
  }
}

export function canIncreaseQuantity(
  productId: string,
  requestedQty: number,
  stockById: Map<string, number>,
): boolean {
  const available = stockById.get(productId) ?? 0;
  return requestedQty <= available;
}

export async function restoreStockForOrder(storeId: string, lines: DraftLine[]): Promise<void> {
  if (lines.length === 0) return;

  const now = Date.now();
  const updatedProducts: Product[] = [];
  const movementLogs: { productId: string; qty: number; before: number; after: number }[] = [];

  await database.write(async () => {
    for (const line of lines) {
      const product = await database.get<Product>("products").find(line.id);
      const currentStock = Number(product.stock ?? 0);
      const nextStock = currentStock + line.quantity;
      await product.update((rec) => {
        rec.stock = nextStock;
        rec.updatedAt = now;
        rec.dirty = true;
      });
      updatedProducts.push(product);
      movementLogs.push({
        productId: product.id,
        qty: line.quantity,
        before: currentStock,
        after: nextStock,
      });
    }
  });

  for (const log of movementLogs) {
    void recordStockMovement({
      storeId,
      productId: log.productId,
      type: "RETURN",
      quantity: log.qty,
      quantityBefore: log.before,
      quantityAfter: log.after,
      reason: "Order Refund / Return",
    }).catch(() => {});
  }

  /*
   * Under Laravel the server owns stock: it derives products.stock from the
   * stock_movements ledger, and the order/return push posts those movements
   * itself. Pushing an absolute quantity from here would be the very race the
   * ledger exists to remove — two offline tills each writing what they believe
   * the total is, and the later one winning.
   *
   * The local figure has already been updated above so the next customer sees a
   * truthful number; the server reconciles from the ledger.
   *
   * This returns BEFORE the catalogue push below, which is where it always
   * meant to be. It used to sit after it, so every sale queued exactly the
   * write this comment calls harmful. A cashier may not edit the catalogue, so
   * the server refused each one — leaving a rejected item in the outbox for
   * every sale, and a "settle the rejected sales" prompt that cried wolf until
   * nobody read it. For a manager, whose role does permit it, there was no
   * refusal and the race was real.
   */
  if (usingLaravel) return;

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


  for (const line of lines) {
    const remoteId = line.remoteId ?? line.id;
    const { data: remoteProduct, error: readError } = await supabase
      .from("products")
      .select("stock")
      .eq("store_id", storeId)
      .eq("id", remoteId)
      .maybeSingle();

    if (readError || !remoteProduct) continue;

    const nextRemoteStock = Number(remoteProduct.stock ?? 0) + line.quantity;
    const { error: updateError } = await supabase
      .from("products")
      .update({ stock: nextRemoteStock })
      .eq("store_id", storeId)
      .eq("id", remoteId);

    if (updateError) throw new Error(updateError.message);
  }
}

export async function decrementStockForOrder(storeId: string, lines: DraftLine[]): Promise<void> {
  if (lines.length === 0) return;

  const stockById = await fetchStockByProductId(
    storeId,
    lines.map((line) => line.id),
  );
  validateCartQuantities(lines, stockById);

  const now = Date.now();
  const updatedProducts: Product[] = [];
  const movementLogs: { productId: string; qty: number; before: number; after: number }[] = [];

  await database.write(async () => {
    for (const line of lines) {
      const product = await database.get<Product>("products").find(line.id);
      const currentStock = Number(product.stock ?? 0);
      const nextStock = currentStock - line.quantity;
      if (nextStock < 0) {
        throw new InsufficientStockError(`"${line.name}" does not have enough stock.`);
      }
      await product.update((rec) => {
        rec.stock = nextStock;
        rec.updatedAt = now;
        rec.dirty = true;
      });
      updatedProducts.push(product);
      movementLogs.push({
        productId: product.id,
        qty: line.quantity,
        before: currentStock,
        after: nextStock,
      });
    }
  });

  for (const log of movementLogs) {
    void recordStockMovement({
      storeId,
      productId: log.productId,
      type: "SALE",
      quantity: -log.qty,
      quantityBefore: log.before,
      quantityAfter: log.after,
      reason: "POS Sale Order",
    }).catch(() => {});
  }

  /*
   * Under Laravel the server owns stock: it derives products.stock from the
   * stock_movements ledger, and the order/return push posts those movements
   * itself. Pushing an absolute quantity from here would be the very race the
   * ledger exists to remove — two offline tills each writing what they believe
   * the total is, and the later one winning.
   *
   * The local figure has already been updated above so the next customer sees a
   * truthful number; the server reconciles from the ledger.
   *
   * This returns BEFORE the catalogue push below, which is where it always
   * meant to be. It used to sit after it, so every sale queued exactly the
   * write this comment calls harmful. A cashier may not edit the catalogue, so
   * the server refused each one — leaving a rejected item in the outbox for
   * every sale, and a "settle the rejected sales" prompt that cried wolf until
   * nobody read it. For a manager, whose role does permit it, there was no
   * refusal and the race was real.
   */
  if (usingLaravel) return;

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


  for (const line of lines) {
    const remoteId = line.remoteId ?? line.id;
    const { data: remoteProduct, error: readError } = await supabase
      .from("products")
      .select("stock")
      .eq("store_id", storeId)
      .eq("id", remoteId)
      .maybeSingle();

    if (readError) throw new Error(readError.message);
    if (!remoteProduct) continue;

    const remoteStock = Number(remoteProduct.stock ?? 0);
    const nextRemoteStock = remoteStock - line.quantity;
    if (nextRemoteStock < 0) {
      throw new InsufficientStockError(`"${line.name}" does not have enough stock in the cloud catalog.`);
    }

    const { error: updateError } = await supabase
      .from("products")
      .update({ stock: nextRemoteStock })
      .eq("store_id", storeId)
      .eq("id", remoteId);

    if (updateError) throw new Error(updateError.message);
  }
}
