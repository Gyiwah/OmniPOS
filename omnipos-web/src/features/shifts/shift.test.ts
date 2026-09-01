import { describe, expect, it } from "vitest";

import type { LocalOrder, LocalPayment, LocalReturn } from "@/db/schema";
import { buildZReport, cashTakenIn, discrepancy, expectedCash, summariseDrawer } from "./shift";

function order(payments: Array<{ method: string; amount: string }>, total = "0.00"): LocalOrder {
  return {
    id: "o", store_id: "s", order_number: "OM-1", status: "completed",
    customer_id: null, customer_name: null, customer_phone: null,
    register_shift_id: "shift", subtotal: total, tax: "0.00", discount: "0.00",
    total, amount_paid: total, change_due: "0.00", payment_method: "cash",
    items: [],
    payments: payments.map((p, i) => ({ id: `p${i}`, method: p.method, amount: p.amount, reference: null })),
    client_created_at: "2026-09-01T10:00:00Z",
    _state: "clean",
  };
}

function refund(amount: string, method = "cash"): LocalReturn {
  return {
    id: "r", store_id: "s", order_id: "o", order_number: "OM-1",
    register_shift_id: "shift", reason: "faulty", amount, refund_method: method,
    items: [], client_created_at: "2026-09-01T11:00:00Z", _state: "clean",
  };
}

function settlement(amount: string, method = "cash"): LocalPayment {
  return {
    id: "s", store_id: "s", customer_id: "c", customer_name: "Ama Mensah",
    order_id: null, register_shift_id: "shift", method, amount,
    reference: null, notes: null, client_created_at: "2026-09-01T12:00:00Z", _state: "clean",
  };
}

const shift = { opening_float: "200.00", movements: [], actual_cash: null };

describe("what reaches the drawer", () => {
  /**
   * The failure this prevents: counting card takings as cash leaves every
   * honest drawer looking short by exactly the day's card sales.
   */
  it("counts only the cash leg of a split tender", () => {
    expect(cashTakenIn(order([{ method: "cash", amount: "30.00" }, { method: "card", amount: "70.00" }]))).toBe(3000);
  });

  it("counts nothing from a card-only sale", () => {
    expect(cashTakenIn(order([{ method: "card", amount: "100.00" }]))).toBe(0);
  });
});

describe("expected cash", () => {
  it("is float plus cash sales less refunds, adjusted for paid in and out", () => {
    expect(
      expectedCash({
        openingFloat: 20000, cashSales: 45000, cashSettlements: 0,
        cashRefunds: 5000, paidIn: 1000, paidOut: 3000,
      }),
    ).toBe(58000);
  });

  /**
   * The server reaches the same number by a different route: refunds are
   * negative rows in the payments ledger, so summing it nets them out and it
   * does NOT subtract them again. Subtracting twice on either side would make an
   * honest till look short by exactly the day's refunds — so this test pins the
   * client's half of that agreement.
   */
  it("subtracts a refund exactly once", () => {
    const withRefund = summariseDrawer(shift, [order([{ method: "cash", amount: "50.00" }], "50.00")], [refund("20.00")]);

    expect(withRefund.cashSales).toBe(5000);
    expect(withRefund.cashRefunds).toBe(2000);
    expect(withRefund.expected).toBe(20000 + 5000 - 2000);
  });

  /**
   * A customer paying off a tab puts cash in the box exactly as a sale does. A
   * drawer that did not count it would come out short by every debt settled
   * during the shift — while the server, which does count it, came out right.
   */
  it("counts a cash settlement against an account", () => {
    const summary = summariseDrawer(shift, [], [], [settlement("35.00")]);

    expect(summary.cashSettlements).toBe(3500);
    expect(summary.expected).toBe(20000 + 3500);
  });

  it("ignores a settlement taken on a card", () => {
    expect(summariseDrawer(shift, [], [], [settlement("35.00", "card")]).cashSettlements).toBe(0);
  });

  it("ignores a refund that was not paid out in cash", () => {
    const summary = summariseDrawer(shift, [], [refund("20.00", "card")]);
    expect(summary.cashRefunds).toBe(0);
    expect(summary.expected).toBe(20000);
  });

  it("applies paid in and paid out from the movement log", () => {
    const withMovements = summariseDrawer(
      {
        opening_float: "100.00",
        movements: [
          { id: "m1", direction: "out", amount: "40.00", reason: "bread supplier", at: "" },
          { id: "m2", direction: "in", amount: "15.00", reason: "float top-up", at: "" },
        ],
      },
      [],
      [],
    );

    expect(withMovements.paidOut).toBe(4000);
    expect(withMovements.paidIn).toBe(1500);
    expect(withMovements.expected).toBe(10000 - 4000 + 1500);
  });
});

describe("discrepancy", () => {
  it("is positive when the drawer is over and negative when short", () => {
    expect(discrepancy(10500, 10000)).toBe(500);
    expect(discrepancy(9500, 10000)).toBe(-500);
  });
});

describe("the Z-report", () => {
  it("nets refunds off the method they were paid back on", () => {
    const report = buildZReport(
      shift,
      [order([{ method: "cash", amount: "60.00" }, { method: "card", amount: "40.00" }], "100.00")],
      [refund("25.00", "card")],
    );

    expect(report.byMethod.find((m) => m.method === "card")?.amount).toBe(1500);
    expect(report.byMethod.find((m) => m.method === "cash")?.amount).toBe(6000);
    expect(report.netSales).toBe(10000 - 2500);
  });

  /**
   * Settlements are cash, but they are not trade done today. Folding them into
   * the day's takings would report business the shop did not do.
   */
  it("keeps settlements out of net sales while still counting them in the drawer", () => {
    const report = buildZReport(
      shift,
      [order([{ method: "cash", amount: "40.00" }], "40.00")],
      [],
      [settlement("60.00")],
    );

    expect(report.netSales).toBe(4000);
    expect(report.settlementTotal).toBe(6000);
    expect(report.drawer.expected).toBe(20000 + 4000 + 6000);
    // The cash channel has to account for all of it, trade or not.
    expect(report.byMethod.find((m) => m.method === "cash")?.amount).toBe(10000);
  });

  it("reports no variance until cash has actually been counted", () => {
    expect(buildZReport(shift, [], []).variance).toBeNull();
    expect(buildZReport({ ...shift, actual_cash: "195.00" }, [], []).variance).toBe(-500);
  });
});
