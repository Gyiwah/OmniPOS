import { api, ApiError } from "@/api/client";
import { uuidv7 } from "@/core/uuidv7";
import { db, type LocalOrder, type LocalReturn, type LocalReturnLine } from "@/db/schema";
import { toDecimal } from "@/features/pos/cart";
import { enqueue } from "@/sync/engine";
import { eligibleLines, type ReturnableLine, type ReturnDraftLine } from "./returns";

/**
 * Taking goods back.
 *
 * A refund is a sale in reverse and gets the same treatment: written locally,
 * queued for the server, never awaiting a request. The stock goes back on the
 * shelf and the money comes out of the drawer whether or not the shop has a
 * connection.
 */

export type ReturnLookup = {
  order: LocalOrder;
  lines: ReturnableLine[];
  /**
   * Whether the eligibility figures came from the server.
   *
   * False means they were worked out from what this till knows, which excludes
   * refunds processed at any other terminal. The UI says so rather than
   * presenting a local guess as fact.
   */
  authoritative: boolean;
};

/**
 * Find the sale being returned.
 *
 * The local copy is used for the receipt itself, because that is what works
 * offline. Eligibility is asked of the server when there is a connection: this
 * till only knows the refunds it processed, and the whole failure this check
 * exists to prevent is two terminals refunding the same items.
 */
export async function lookupOrder(storeId: string, reference: string): Promise<ReturnLookup | null> {
  const needle = reference.trim().toLowerCase();
  if (!needle) return null;

  const local = await db.orders
    .where("store_id")
    .equals(storeId)
    .filter((o) => o.order_number.toLowerCase() === needle)
    .first();

  const order = local ?? (await fetchOrder(storeId, needle));
  if (!order) return null;

  // A sale still sitting in the outbox is not on the server yet, so the server
  // cannot rule on it — and returning against it would queue a refund the
  // server must reject for referencing a sale it has never seen.
  if (order._state === "pending") {
    const priorReturns = await localReturnsFor(order.id);
    return { order, lines: eligibleLines(order, priorReturns), authoritative: false };
  }

  const remote = await fetchEligibility(order.id);
  if (remote) return { order, lines: remote, authoritative: true };

  const priorReturns = await localReturnsFor(order.id);
  return { order, lines: eligibleLines(order, priorReturns), authoritative: false };
}

async function localReturnsFor(orderId: string): Promise<LocalReturn[]> {
  return db.returns.where("order_id").equals(orderId).toArray();
}

/**
 * Pull a sale rung up on another till.
 *
 * Without this a customer can only be refunded at the terminal that served
 * them, which is not how a shop with two tills works. It is stored locally so
 * the receipt reprints and the return survives the connection dropping midway.
 */
async function fetchOrder(storeId: string, reference: string): Promise<LocalOrder | null> {
  if (!navigator.onLine) return null;

  try {
    const search = await api.get<{ data: Array<Record<string, unknown>> }>("/api/orders", {
      search: reference,
      per_page: 5,
    });

    const match =
      search.data?.find((o) => String(o.order_number ?? "").toLowerCase() === reference) ?? search.data?.[0];
    if (!match) return null;

    const full = await api.get<{ data: Record<string, unknown> }>(`/api/orders/${String(match.id)}`);
    const order = mapServerOrder(storeId, full.data);

    await db.orders.put(order);
    return order;
  } catch (error) {
    if (error instanceof ApiError && error.isUnreachable) return null;
    throw error;
  }
}

async function fetchEligibility(orderId: string): Promise<ReturnableLine[] | null> {
  if (!navigator.onLine) return null;

  try {
    const res = await api.get<{
      lines: Array<{
        order_item_id: string;
        product_id: string | null;
        product_name: string;
        unit_price: string;
        quantity_sold: number;
        quantity_returned: number;
        quantity_eligible: number;
      }>;
    }>(`/api/returns/eligibility/${orderId}`);

    return (res.lines ?? []).map((l) => ({
      orderItemId: l.order_item_id,
      productId: l.product_id,
      name: l.product_name,
      unitPrice: Math.round(Number(l.unit_price) * 100),
      quantitySold: l.quantity_sold,
      quantityReturned: l.quantity_returned,
      quantityEligible: l.quantity_eligible,
    }));
  } catch {
    // Offline, or the server has never seen this sale. Either way the caller
    // falls back to local figures and is told they are local.
    return null;
  }
}

export async function processReturn(input: {
  storeId: string;
  order: LocalOrder;
  lines: ReturnableLine[];
  draft: ReturnDraftLine[];
  reason: string;
  refundMethod: string;
  registerShiftId: string | null;
}): Promise<LocalReturn> {
  const byId = new Map(input.lines.map((l) => [l.orderItemId, l]));

  const items: LocalReturnLine[] = input.draft
    .filter((d) => d.quantity > 0)
    .map((d) => {
      const line = byId.get(d.orderItemId);
      if (!line) throw new Error("A returned line is not part of this sale.");

      return {
        id: uuidv7(),
        order_item_id: d.orderItemId,
        product_id: line.productId,
        product_name: line.name,
        unit_price: toDecimal(line.unitPrice),
        quantity: d.quantity,
        line_total: toDecimal(line.unitPrice * d.quantity),
        restock: d.restock,
      };
    });

  const amount = items.reduce((sum, i) => sum + Math.round(Number(i.line_total) * 100), 0);

  const record: LocalReturn = {
    id: uuidv7(),
    store_id: input.storeId,
    order_id: input.order.id,
    order_number: input.order.order_number,
    register_shift_id: input.registerShiftId,
    reason: input.reason.trim(),
    amount: toDecimal(amount),
    refund_method: input.refundMethod,
    items,
    client_created_at: new Date().toISOString(),
    _state: "pending",
  };

  await db.transaction("rw", [db.returns, db.products, db.outbox], async () => {
    await db.returns.put(record);

    // Goods physically back on the shelf. As with a sale, this is only the
    // till's own running figure — the server recomputes from the movement
    // ledger, which is what lets two offline terminals both be right.
    for (const item of items) {
      if (!item.restock || !item.product_id) continue;
      const product = await db.products.get(item.product_id);
      if (!product) continue;
      await db.products.update(item.product_id, { stock: product.stock + item.quantity });
    }

    await enqueue({
      storeId: input.storeId,
      entity: "returns",
      action: "upsert",
      recordId: record.id,
      payload: {
        id: record.id,
        order_id: record.order_id,
        register_shift_id: record.register_shift_id,
        reason: record.reason,
        amount: record.amount,
        refund_method: record.refund_method,
        client_created_at: record.client_created_at,
        items: record.items,
      },
    });
  });

  return record;
}

/**
 * A server order in the local shape.
 *
 * The line ids matter more than anything else here: they are what a return
 * references, and both clients mint them as UUIDv7 that the server stores
 * verbatim, so the id on a sale from another till is the id this refund must
 * quote.
 */
export function mapServerOrder(storeId: string, o: Record<string, unknown>): LocalOrder {
  const s = (v: unknown, fallback = "") => (v === null || v === undefined ? fallback : String(v));

  const items = Array.isArray(o.items) ? (o.items as Array<Record<string, unknown>>) : [];
  const payments = Array.isArray(o.payments) ? (o.payments as Array<Record<string, unknown>>) : [];

  return {
    id: s(o.id),
    store_id: s(o.store_id, storeId),
    order_number: s(o.order_number),
    status: s(o.status, "completed"),
    customer_id: o.customer_id ? s(o.customer_id) : null,
    customer_name: o.customer_name ? s(o.customer_name) : null,
    customer_phone: o.customer_phone ? s(o.customer_phone) : null,
    register_shift_id: o.register_shift_id ? s(o.register_shift_id) : null,
    subtotal: s(o.subtotal, "0.00"),
    tax: s(o.tax, "0.00"),
    discount: s(o.discount, "0.00"),
    total: s(o.total, "0.00"),
    amount_paid: s(o.amount_paid, "0.00"),
    change_due: s(o.change_due, "0.00"),
    payment_method: s(o.payment_method, "cash"),
    items: items.map((i) => ({
      id: s(i.id),
      product_id: i.product_id ? s(i.product_id) : null,
      product_name: s(i.product_name),
      sku: i.sku ? s(i.sku) : null,
      barcode: i.barcode ? s(i.barcode) : null,
      unit_price: s(i.unit_price, "0.00"),
      quantity: Number(i.quantity ?? 0),
      line_total: s(i.line_total, "0.00"),
      unit_cost: i.unit_cost === null || i.unit_cost === undefined ? null : s(i.unit_cost),
    })),
    payments: payments.map((p) => ({
      id: s(p.id),
      method: s(p.method, "cash"),
      amount: s(p.amount, "0.00"),
      reference: p.reference ? s(p.reference) : null,
    })),
    client_created_at: s(o.client_created_at, s(o.created_at, new Date().toISOString())),
    // It came from the server, so it is on the books by definition.
    _state: "clean",
  };
}
