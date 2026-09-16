import { uuidv7 } from "@/core/uuidv7";
import { db, type LocalOrder, type LocalOrderLine, type LocalPaymentSplit } from "@/db/schema";
import { enqueue } from "@/sync/engine";
import {
  amountPaid,
  changeDue,
  computeTotals,
  lineTotal,
  toDecimal,
  type CartLine,
  type DiscountMode,
  type TaxRates,
  type TenderLine,
} from "./cart";

/**
 * Completing a sale.
 *
 * The order is written locally, the local stock figures are decremented, and a
 * sync operation is queued — all in one IndexedDB transaction. The network is
 * not involved. A till with no connection completes sales exactly as one with a
 * connection does; the only difference is how long the operation waits in the
 * outbox.
 *
 * The order id is minted here and is the id the server will use. That is what
 * makes the push idempotent: if the response is lost and the operation retried,
 * the server recognises the same id and does not book a second sale.
 */

export type CheckoutInput = {
  storeId: string;
  lines: CartLine[];
  discountMode: DiscountMode;
  discountValue: number;
  rates: TaxRates;
  tenders: TenderLine[];
  customer: { id: string; name: string; phone: string | null } | null;
  walkInName?: string | null;
  walkInPhone?: string | null;
  registerShiftId: string | null;
  orderNumber: string;
};

export async function completeSale(input: CheckoutInput): Promise<LocalOrder> {
  const totals = computeTotals(input.lines, input.discountMode, input.discountValue, input.rates);
  const paid = amountPaid(totals.total, input.tenders);
  const change = changeDue(totals.total, input.tenders);

  const items: LocalOrderLine[] = input.lines.map((line) => ({
    id: uuidv7(),
    product_id: line.productId,
    product_name: line.name,
    sku: line.sku,
    barcode: line.barcode,
    unit_price: toDecimal(line.unitPrice),
    quantity: line.quantity,
    line_total: toDecimal(lineTotal(line)),
    unit_cost: line.unitCost === null ? null : toDecimal(line.unitCost),
  }));

  const payments: LocalPaymentSplit[] = input.tenders
    .filter((t) => t.amount > 0)
    .map((t) => ({
      id: uuidv7(),
      method: t.method,
      // Capped at the total so change handed back is not recorded as revenue.
      amount: toDecimal(Math.min(t.amount, totals.total)),
      reference: null,
    }));

  const order: LocalOrder = {
    id: uuidv7(),
    store_id: input.storeId,
    order_number: input.orderNumber,
    status: "completed",
    customer_id: input.customer?.id ?? null,
    customer_name: input.customer?.name ?? input.walkInName ?? null,
    customer_phone: input.customer?.phone ?? input.walkInPhone ?? null,
    register_shift_id: input.registerShiftId,
    subtotal: toDecimal(totals.subtotal),
    tax: toDecimal(totals.tax),
    discount: toDecimal(totals.discount),
    total: toDecimal(totals.total),
    amount_paid: toDecimal(paid),
    change_due: toDecimal(change),
    payment_method: payments.length > 1 ? "split" : (payments[0]?.method ?? "cash"),
    items,
    payments,
    client_created_at: new Date().toISOString(),
    _state: "pending",
  };

  await db.transaction("rw", [db.orders, db.products, db.outbox], async () => {
    // Re-check inside the write transaction: the cart snapshot can be stale if
    // another tab or sale changed the product after it was added.
    for (const line of input.lines) {
      if (!line.productId) continue;
      const product = await db.products.get(line.productId);
      if (!product) throw new Error(`${line.name} is no longer available.`);
      if (line.quantity > product.stock) {
        throw new Error(`Not enough stock for ${line.name}. Only ${product.stock} remain.`);
      }
    }

    await db.orders.put(order);

    // Decrement what this till believes it has, so the next customer sees a
    // truthful figure. The server recomputes stock from the movement ledger.
    for (const line of input.lines) {
      if (!line.productId) continue;
      const product = await db.products.get(line.productId);
      if (!product) continue;
      await db.products.update(line.productId, { stock: product.stock - line.quantity });
    }

    await enqueue({
      storeId: input.storeId,
      entity: "orders",
      action: "upsert",
      recordId: order.id,
      payload: {
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        customer_id: order.customer_id,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        register_shift_id: order.register_shift_id,
        subtotal: order.subtotal,
        tax: order.tax,
        discount: order.discount,
        total: order.total,
        discount_mode: input.discountMode,
        discount_value: toDecimal(
          input.discountMode === "percentage" ? input.discountValue * 100 : input.discountValue,
        ),
        amount_paid: order.amount_paid,
        change_due: order.change_due,
        payment_method: order.payment_method,
        client_created_at: order.client_created_at,
        items: order.items,
        payments: order.payments,
      },
    });
  });

  return order;
}

/**
 * Receipt numbers are generated per till and per day: OM-YYYYMMDD-NNNN.
 *
 * Two tills working offline can still land on the same number. The server treats
 * that as a conflict and reports it rather than silently renumbering, because
 * the customer is holding a paper receipt with the original on it.
 */
export async function nextOrderNumber(storeId: string): Promise<string> {
  const today = new Date();
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("");

  const prefix = `OM-${stamp}-`;

  const todays = await db.orders
    .where("store_id")
    .equals(storeId)
    .filter((o) => o.order_number.startsWith(prefix))
    .toArray();

  const highest = todays.reduce((max, o) => {
    const n = Number.parseInt(o.order_number.slice(prefix.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}
