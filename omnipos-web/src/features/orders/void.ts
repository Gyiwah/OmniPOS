import { api } from "@/api/client";
import { db } from "@/db/schema";

/**
 * Voiding a sale.
 *
 * Online only, and deliberately so. A void reverses stock and a customer's
 * balance across the whole store, and the server is the only party that knows
 * what has happened to that sale since — another till may have refunded part of
 * it, or taken payment against it. Queueing a void offline would let a manager
 * reverse a sale on figures that were already stale.
 *
 * That is the opposite of the rule for selling, and the difference is who is
 * waiting. A cashier with a customer at the counter cannot wait for a network; a
 * manager correcting yesterday's mistake can.
 */
export async function voidOrder(input: {
  orderId: string;
  reason: string;
  restock: boolean;
}): Promise<void> {
  if (!input.reason.trim()) {
    // The server requires it too. Asked for here so the manager is told before
    // the request rather than after.
    throw new Error("Say why the sale is being voided.");
  }

  await api.post(`/api/orders/${input.orderId}/void`, {
    reason: input.reason.trim(),
    restock: input.restock,
  });

  // The local copy is corrected immediately rather than waiting for the pull, so
  // the Orders list cannot keep showing a voided sale as booked while the
  // manager is looking at it.
  const local = await db.orders.get(input.orderId);
  if (!local) return;

  await db.transaction("rw", [db.orders, db.products], async () => {
    await db.orders.update(input.orderId, { status: "voided" });

    if (!input.restock) return;

    // Mirrors what the server just did to the ledger. Its figures are
    // authoritative and arrive on the next pull; this only stops the shelf
    // count on screen being wrong in the meantime.
    for (const item of local.items) {
      if (!item.product_id) continue;
      const product = await db.products.get(item.product_id);
      if (!product) continue;
      await db.products.update(item.product_id, { stock: product.stock + item.quantity });
    }
  });
}
