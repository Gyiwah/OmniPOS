import type { LocalOrder, LocalReturn } from "@/db/schema";
import { toMinor } from "@/features/pos/cart";

/**
 * What may still be brought back, and what it is worth.
 *
 * The honest caveat lives in this file's shape rather than its comments: every
 * function here takes the set of returns it should count. Pass the ones this
 * till knows about and you get this till's answer; pass the server's and you get
 * the real one. The caller is forced to say which, because the difference is a
 * customer being refunded twice.
 */

export type ReturnableLine = {
  orderItemId: string;
  productId: string | null;
  name: string;
  /** Minor units. */
  unitPrice: number;
  quantitySold: number;
  quantityReturned: number;
  quantityEligible: number;
};

export type ReturnDraftLine = {
  orderItemId: string;
  quantity: number;
  restock: boolean;
};

export function eligibleLines(order: LocalOrder, priorReturns: LocalReturn[]): ReturnableLine[] {
  const returnedByItem = new Map<string, number>();

  for (const ret of priorReturns) {
    // A refund a manager discarded never happened, so the goods it covered are
    // still returnable.
    if (ret._state === "discarded") continue;
    for (const line of ret.items) {
      returnedByItem.set(line.order_item_id, (returnedByItem.get(line.order_item_id) ?? 0) + line.quantity);
    }
  }

  return order.items.map((item) => {
    const returned = returnedByItem.get(item.id) ?? 0;
    return {
      orderItemId: item.id,
      productId: item.product_id,
      name: item.product_name,
      unitPrice: toMinor(item.unit_price),
      quantitySold: item.quantity,
      quantityReturned: returned,
      quantityEligible: Math.max(0, item.quantity - returned),
    };
  });
}

export function refundTotal(lines: ReturnableLine[], draft: ReturnDraftLine[]): number {
  const byId = new Map(lines.map((l) => [l.orderItemId, l]));

  return draft.reduce((sum, d) => {
    const line = byId.get(d.orderItemId);
    if (!line || d.quantity <= 0) return sum;
    return sum + line.unitPrice * d.quantity;
  }, 0);
}

export type ReturnVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether the refund may be recorded.
 *
 * Over-quantity is refused outright rather than queued and rejected later. The
 * server would catch it, but by then the cash is out of the drawer and the
 * customer has left — a conflict is the wrong tool for something the till can
 * see is wrong while the customer is still standing there.
 */
export function canRefund(
  lines: ReturnableLine[],
  draft: ReturnDraftLine[],
  reason: string,
): ReturnVerdict {
  const chosen = draft.filter((d) => d.quantity > 0);

  if (chosen.length === 0) {
    return { ok: false, reason: "Choose at least one item to return." };
  }

  if (!reason.trim()) {
    return { ok: false, reason: "Give a reason for the return." };
  }

  const byId = new Map(lines.map((l) => [l.orderItemId, l]));

  for (const d of chosen) {
    const line = byId.get(d.orderItemId);
    if (!line) return { ok: false, reason: "One of the lines is not part of this sale." };

    if (d.quantity > line.quantityEligible) {
      return {
        ok: false,
        reason:
          line.quantityEligible === 0
            ? `"${line.name}" has already been returned in full.`
            : `Only ${line.quantityEligible} of "${line.name}" can still be returned.`,
      };
    }
  }

  return { ok: true };
}

/**
 * A refund cannot exceed what was actually paid.
 *
 * A sale left partly on account only put part of the money in the shop. Handing
 * back the full ticket price turns a return into a cash withdrawal against a
 * debt the customer still owes.
 */
export function maxCashRefund(order: LocalOrder): number {
  return toMinor(order.amount_paid);
}
