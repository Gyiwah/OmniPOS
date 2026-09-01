import { describe, expect, it } from "vitest";

import type { LocalOrder, LocalReturn } from "@/db/schema";
import { canRefund, eligibleLines, maxCashRefund, refundTotal } from "./returns";

const order: LocalOrder = {
  id: "o1", store_id: "s", order_number: "OM-20260901-0001", status: "completed",
  customer_id: null, customer_name: null, customer_phone: null, register_shift_id: null,
  subtotal: "50.00", tax: "0.00", discount: "0.00", total: "50.00",
  amount_paid: "50.00", change_due: "0.00", payment_method: "cash",
  items: [
    { id: "i1", product_id: "p1", product_name: "Meat Pie", sku: "MP", barcode: null,
      unit_price: "8.00", quantity: 3, line_total: "24.00", unit_cost: null },
    { id: "i2", product_id: "p2", product_name: "Voltic Water", sku: "VW", barcode: null,
      unit_price: "5.00", quantity: 2, line_total: "10.00", unit_cost: null },
  ],
  payments: [{ id: "pay1", method: "cash", amount: "50.00", reference: null }],
  client_created_at: "2026-09-01T09:00:00Z",
  _state: "clean",
};

function priorReturn(orderItemId: string, quantity: number, state: LocalReturn["_state"] = "clean"): LocalReturn {
  return {
    id: `r-${orderItemId}-${quantity}`, store_id: "s", order_id: "o1", order_number: order.order_number,
    register_shift_id: null, reason: "faulty", amount: "0.00", refund_method: "cash",
    items: [{
      id: "ri", order_item_id: orderItemId, product_id: null, product_name: "x",
      unit_price: "0.00", quantity, line_total: "0.00", restock: true,
    }],
    client_created_at: "2026-09-01T10:00:00Z",
    _state: state,
  };
}

describe("eligibility", () => {
  it("offers everything back when nothing has been returned", () => {
    const lines = eligibleLines(order, []);
    expect(lines.map((l) => l.quantityEligible)).toEqual([3, 2]);
  });

  it("deducts what has already come back", () => {
    const lines = eligibleLines(order, [priorReturn("i1", 2)]);
    expect(lines[0].quantityEligible).toBe(1);
    expect(lines[0].quantityReturned).toBe(2);
    expect(lines[1].quantityEligible).toBe(2);
  });

  it("sums returns across separate visits", () => {
    const lines = eligibleLines(order, [priorReturn("i1", 1), priorReturn("i1", 2)]);
    expect(lines[0].quantityEligible).toBe(0);
  });

  /** A refund a manager threw away never happened, so the goods are returnable. */
  it("ignores a discarded refund", () => {
    const lines = eligibleLines(order, [priorReturn("i1", 3, "discarded")]);
    expect(lines[0].quantityEligible).toBe(3);
  });

  it("never reports a negative eligibility", () => {
    const lines = eligibleLines(order, [priorReturn("i1", 99)]);
    expect(lines[0].quantityEligible).toBe(0);
  });
});

describe("refusing a refund", () => {
  const lines = eligibleLines(order, [priorReturn("i1", 2)]);

  it("refuses more than is still eligible", () => {
    const verdict = canRefund(lines, [{ orderItemId: "i1", quantity: 2, restock: true }], "faulty");
    expect(verdict).toEqual({ ok: false, reason: 'Only 1 of "Meat Pie" can still be returned.' });
  });

  it("says so plainly when a line is already fully back", () => {
    const exhausted = eligibleLines(order, [priorReturn("i1", 3)]);
    const verdict = canRefund(exhausted, [{ orderItemId: "i1", quantity: 1, restock: true }], "faulty");
    expect(verdict).toEqual({ ok: false, reason: '"Meat Pie" has already been returned in full.' });
  });

  it("requires a reason", () => {
    const verdict = canRefund(lines, [{ orderItemId: "i2", quantity: 1, restock: true }], "  ");
    expect(verdict.ok).toBe(false);
  });

  it("requires at least one line", () => {
    const verdict = canRefund(lines, [{ orderItemId: "i1", quantity: 0, restock: true }], "faulty");
    expect(verdict.ok).toBe(false);
  });

  it("allows a refund within what is left", () => {
    expect(canRefund(lines, [{ orderItemId: "i1", quantity: 1, restock: true }], "faulty")).toEqual({ ok: true });
  });
});

describe("refund value", () => {
  it("prices each line at what it was sold for", () => {
    const lines = eligibleLines(order, []);
    const total = refundTotal(lines, [
      { orderItemId: "i1", quantity: 2, restock: true },
      { orderItemId: "i2", quantity: 1, restock: true },
    ]);
    expect(total).toBe(2100);
  });

  /**
   * A sale left partly on account only put part of the money in the shop.
   * Refunding the full ticket price turns a return into a cash withdrawal
   * against a debt the customer still owes.
   */
  it("caps against what was actually paid, not what was billed", () => {
    expect(maxCashRefund({ ...order, amount_paid: "20.00" })).toBe(2000);
  });
});
