import { uuidv7 } from "@/core/uuidv7";
import { db, type LocalProduct } from "@/db/schema";
import { toDecimal } from "@/features/pos/cart";
import { enqueue } from "@/sync/engine";

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
    tags: existing?.tags ?? [],
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
      },
    });
  });

  return product;
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
