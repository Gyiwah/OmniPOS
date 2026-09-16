import { uuidv7 } from "@/core/uuidv7";
import { db, type LocalBatch, type LocalProduct } from "@/db/schema";
import { toDecimal } from "@/features/pos/cart";
import { enqueue } from "@/sync/engine";
import type { ImportRow } from "./csvImport";

/**
 * Creating and editing products from the till.
 *
 * Two things about this are not obvious and both come from the server's design:
 *
 * STOCK IS NOT AN ATTRIBUTE. The product handler ignores a `stock` field
 * entirely — quantities move only through the movement ledger. So an opening
 * quantity is a second operation, a stock movement, not a column on the product.
 * Accepting an absolute figure here would let a device that synced late
 * overwrite another till's sales with a number from before them.
 *
 * SKU CLASHES ARE A HUMAN'S PROBLEM. Two tills that both invent "SKU-1" while
 * offline produce a real conflict, and the server reports it rather than
 * renaming one. The local default is time-ordered to make that rare, but it
 * cannot make it impossible.
 */

export type ProductInput = {
  name: string;
  sku: string;
  barcode: string | null;
  /** Minor units. */
  price: number;
  costPrice: number | null;
  reorderLevel: number;
  categoryId: string | null;
  isActive: boolean;
  tags?: string[];
};

export async function saveProduct(
  storeId: string,
  input: ProductInput,
  existing?: LocalProduct,
): Promise<LocalProduct> {
  const name = input.name.trim();
  const sku = input.sku.trim();

  if (!name) throw new Error("A product needs a name.");
  if (!sku) throw new Error("A product needs a SKU.");

  const clash = await db.products
    .where("store_id")
    .equals(storeId)
    .filter((p) => p.sku.toLowerCase() === sku.toLowerCase() && p.id !== existing?.id)
    .first();

  if (clash) {
    // The server would reject this too, but hours later and as a sync conflict.
    // Catching it while the form is open is the difference between a typo and
    // an incident.
    throw new Error(`SKU ${sku} already belongs to "${clash.name}".`);
  }

  const product: LocalProduct = {
    id: existing?.id ?? uuidv7(),
    store_id: storeId,
    category_id: input.categoryId,
    name,
    sku,
    barcode: input.barcode?.trim() ? input.barcode.trim() : null,
    price: toDecimal(input.price),
    cost_price: input.costPrice === null ? null : toDecimal(input.costPrice),
    // Untouched on edit, and zero on create. Stock arrives through movements.
    stock: existing?.stock ?? 0,
    reorder_level: input.reorderLevel,
    image_url: existing?.image_url ?? null,
    tags: input.tags ?? existing?.tags ?? [],
    is_active: input.isActive,
    updated_at: new Date().toISOString(),
    search_key: `${name} ${sku}`.toLowerCase(),
  };

  await db.transaction("rw", [db.products, db.outbox], async () => {
    await db.products.put(product);
    await enqueue({
      storeId,
      entity: "products",
      action: "upsert",
      recordId: product.id,
      payload: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        price: product.price,
        cost_price: product.cost_price,
        reorder_level: product.reorder_level,
        category_id: product.category_id,
        is_active: product.is_active,
        tags: product.tags,
      },
    });
  });

  return product;
}

export async function deleteProduct(storeId: string, productId: string): Promise<void> {
  return deleteProducts(storeId, [productId]);
}

export async function deleteProducts(storeId: string, productIds: string[]): Promise<void> {
  await db.transaction("rw", [db.products, db.outbox], async () => {
    for (const productId of productIds) {
      const product = await db.products.get(productId);
      if (!product) throw new Error("That product is not on this till.");

      await db.products.delete(productId);
      await enqueue({
        storeId,
        entity: "products",
        action: "delete",
        recordId: productId,
        payload: {},
      });
    }
  });
}

/**
 * The movement types the server's schema accepts.
 *
 * Named rather than inlined because inventing one is silent: the check
 * constraint rejects it, the till only learns "could not be applied", and the
 * adjustment retries for ever without ever landing.
 */
export type MovementType = "STOCK_IN" | "STOCK_OUT" | "ADJUSTMENT" | "DAMAGE" | "EXPIRED" | "AUDIT";

/**
 * Move stock: a delivery arriving, a breakage, a count correction.
 *
 * The quantity is a delta, not a new total, because that is what the ledger
 * stores and what makes two offline tills reconcilable. A stock take that wants
 * to say "there are 40 of these" has to say "add 7" — the caller works out the
 * difference from what it believes it has, and if that belief was stale the
 * ledger still ends up consistent with every other movement.
 */
export async function adjustStock(input: {
  storeId: string;
  productId: string;
  delta: number;
  type: MovementType;
  reason: string;
}): Promise<void> {
  if (input.delta === 0) throw new Error("A stock movement needs a non-zero quantity.");
  if (!input.reason.trim()) throw new Error("Say why the stock is moving.");

  await db.transaction("rw", [db.products, db.outbox], async () => {
    const product = await db.products.get(input.productId);
    if (!product) throw new Error("That product is not on this till.");

    await db.products.update(input.productId, { stock: product.stock + input.delta });

    await enqueue({
      storeId: input.storeId,
      entity: "stock_movements",
      action: "upsert",
      // The movement's own id. Re-pushing an interrupted adjustment cannot
      // apply it twice.
      recordId: uuidv7(),
      payload: {
        product_id: input.productId,
        type: input.type,
        quantity: input.delta,
        reason: input.reason.trim(),
        client_created_at: new Date().toISOString(),
      },
    });
  });
}

/**
 * A SKU that is unlikely to collide but still readable at a counter.
 *
 * Derived from the name plus a short time-ordered suffix rather than a running
 * counter, because a counter is exactly what two offline tills would both
 * increment to the same value.
 */
export function suggestSku(name: string): string {
  const stem =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 12) || "ITEM";

  return `${stem}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

/**
 * A batch number for a shop that does not use lot numbers.
 *
 * The server requires one and enforces uniqueness per product, but plenty of
 * shops track expiry without ever seeing a lot number on the box. Deriving it
 * from the expiry date gives something meaningful rather than a random string —
 * and makes the uniqueness rule do something useful, since two deliveries that
 * expire on the same day are the same batch for every practical purpose.
 *
 * Shown in the field's placeholder, so it is a visible default rather than a
 * value that silently appears afterwards.
 */
export function suggestBatchNumber(expiryDate: string | null): string {
  if (expiryDate) return `EXP-${expiryDate.replace(/-/g, "")}`;

  return `IN-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
}

/**
 * Record a delivery as its own batch, so its expiry can be tracked separately.
 *
 * The batch and the stock movement are two operations, not one. The batch says
 * "these 48 expire in March"; the movement says "there are 48 more on the
 * shelf". Collapsing them would either lose the expiry date or let a batch
 * silently move stock, and the ledger has to stay the only thing that does.
 */
export async function addBatch(input: {
  storeId: string;
  productId: string;
  batchNumber: string | null;
  quantity: number;
  costPrice: number | null;
  expiryDate: string | null;
  /** Whether this delivery also puts the goods on the shelf. */
  addToStock: boolean;
}): Promise<LocalBatch> {
  if (input.quantity <= 0) throw new Error("A batch needs a quantity.");

  const batchNumber = input.batchNumber?.trim() || suggestBatchNumber(input.expiryDate);

  const batch: LocalBatch = {
    id: uuidv7(),
    store_id: input.storeId,
    product_id: input.productId,
    batch_number: batchNumber,
    quantity: String(input.quantity),
    cost_price: input.costPrice === null ? null : toDecimal(input.costPrice),
    expiry_date: input.expiryDate || null,
    _state: "pending",
  };

  await db.transaction("rw", [db.batches, db.outbox], async () => {
    await db.batches.put(batch);
    await enqueue({
      storeId: input.storeId,
      entity: "product_batches",
      action: "upsert",
      recordId: batch.id,
      payload: {
        id: batch.id,
        product_id: batch.product_id,
        batch_number: batch.batch_number,
        quantity: input.quantity,
        cost_price: batch.cost_price,
        expiry_date: batch.expiry_date,
      },
    });
  });

  if (input.addToStock) {
    await adjustStock({
      storeId: input.storeId,
      productId: input.productId,
      delta: input.quantity,
      type: "STOCK_IN",
      reason: batch.batch_number ? `Batch ${batch.batch_number} received` : "Delivery received",
    });
  }

  return batch;
}

/**
 * Note that a price moved, and why.
 *
 * Recorded as its own record rather than inferred from the product, because a
 * product only ever shows what it costs now. "It has always been twelve" is a
 * claim nobody can check without this, and it is the claim that gets made when
 * a customer disputes a price.
 */
export async function recordPriceChange(input: {
  storeId: string;
  productId: string;
  oldPrice: number;
  newPrice: number;
  oldCost: number | null;
  newCost: number | null;
  reason?: string | null;
}): Promise<void> {
  // Nothing moved, nothing to record. Writing a row for every save would bury
  // the real changes in noise.
  if (input.oldPrice === input.newPrice && input.oldCost === input.newCost) return;

  await enqueue({
    storeId: input.storeId,
    entity: "price_history",
    action: "upsert",
    recordId: uuidv7(),
    payload: {
      product_id: input.productId,
      old_sell_price: toDecimal(input.oldPrice),
      new_sell_price: toDecimal(input.newPrice),
      old_cost_price: input.oldCost === null ? null : toDecimal(input.oldCost),
      new_cost_price: input.newCost === null ? null : toDecimal(input.newCost),
      reason: input.reason?.trim() || "Price updated",
      client_created_at: new Date().toISOString(),
    },
  });
}

/**
 * Apply a reviewed import.
 *
 * Stock is the subtle part. A CSV's stock column becomes an opening movement
 * for a NEW product only. For one that already exists the number is ambiguous —
 * it could be a fresh count or a delivery, and the file cannot say which — so it
 * is left alone rather than guessed at. A spreadsheet silently overwriting stock
 * would erase every sale made since it was exported, which is the worst thing an
 * import can do and the hardest to notice.
 *
 * Each row is its own operation. A file that fails half way leaves the products
 * it did import genuinely imported, rather than rolling back work a shop watched
 * succeed.
 */
export async function importProducts(
  storeId: string,
  rows: ImportRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ created: number; updated: number; failed: Array<{ line: number; reason: string }> }> {
  const applicable = rows.filter((r) => r.action !== "skip");

  let created = 0;
  let updated = 0;
  const failed: Array<{ line: number; reason: string }> = [];

  for (const [index, row] of applicable.entries()) {
    try {
      const existing = await db.products
        .where("store_id")
        .equals(storeId)
        .filter((p) => p.sku.toLowerCase() === row.sku.toLowerCase())
        .first();

      const saved = await saveProduct(
        storeId,
        {
          name: row.name,
          sku: row.sku,
          barcode: row.barcode,
          price: row.price,
          costPrice: row.cost,
          reorderLevel: row.reorderLevel,
          categoryId: existing?.category_id ?? null,
          isActive: true,
          tags: row.tags.length > 0 ? row.tags : existing?.tags,
        },
        existing,
      );

      if (existing) {
        updated += 1;
      } else {
        created += 1;
        if (row.stock > 0) {
          await adjustStock({
            storeId,
            productId: saved.id,
            delta: row.stock,
            type: "STOCK_IN",
            reason: "Opening count from import",
          });
        }
      }
    } catch (error) {
      failed.push({ line: row.line, reason: error instanceof Error ? error.message : "Could not import" });
    }

    onProgress?.(index + 1, applicable.length);
  }

  return { created, updated, failed };
}
