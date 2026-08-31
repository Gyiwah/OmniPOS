import { describe, expect, it } from "vitest";

import {
  addLine,
  amountPaid,
  balanceDue,
  canComplete,
  changeDue,
  computeTotals,
  oversoldLines,
  setQuantity,
  toDecimal,
  toMinor,
  type CartLine,
} from "./cart";

const line = (over: Partial<CartLine> = {}): CartLine => ({
  id: "l1",
  productId: "p1",
  name: "Widget",
  sku: "SKU-1",
  barcode: null,
  unitPrice: 1000,
  unitCost: 600,
  quantity: 1,
  availableStock: 10,
  ...over,
});

const NO_TAX = { taxRate: 0, vatRate: 0, serviceRate: 0 };

describe("money conversion", () => {
  it("round-trips decimal strings without float drift", () => {
    for (const value of ["0.01", "0.10", "1.15", "12.50", "999.99", "1234.05"]) {
      expect(toDecimal(toMinor(value))).toBe(value);
    }
  });

  it("survives the classic float case", () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004.
    expect(toDecimal(toMinor("0.10") + toMinor("0.20"))).toBe("0.30");
  });

  it("tolerates blanks, symbols and nonsense", () => {
    expect(toMinor("")).toBe(0);
    expect(toMinor(null)).toBe(0);
    expect(toMinor("GHS 12.50")).toBe(1250);
    expect(toMinor("abc")).toBe(0);
  });
});

describe("totals", () => {
  it("sums lines", () => {
    const totals = computeTotals([line({ quantity: 3 })], "percentage", 0, NO_TAX);
    expect(totals.subtotal).toBe(3000);
    expect(totals.total).toBe(3000);
  });

  it("applies a percentage discount to the whole basket", () => {
    const totals = computeTotals([line({ quantity: 2 })], "percentage", 10, NO_TAX);
    expect(totals.discount).toBe(200);
    expect(totals.total).toBe(1800);
  });

  it("never discounts below zero", () => {
    const totals = computeTotals([line()], "amount", 99999, NO_TAX);
    expect(totals.discount).toBe(1000);
    expect(totals.total).toBe(0);
  });

  it("taxes the discounted amount, not the gross", () => {
    // 10.00 less 10% = 9.00, taxed at 10% = 0.90.
    const totals = computeTotals([line()], "percentage", 10, { ...NO_TAX, taxRate: 10 });
    expect(totals.taxable).toBe(900);
    expect(totals.tax).toBe(90);
    expect(totals.total).toBe(990);
  });

  it("combines tax, vat and service rates", () => {
    const totals = computeTotals([line()], "percentage", 0, { taxRate: 5, vatRate: 3, serviceRate: 2 });
    expect(totals.tax).toBe(100);
  });

  it("ignores nonsensical rates rather than producing a negative total", () => {
    const totals = computeTotals([line()], "percentage", -50, { taxRate: -10, vatRate: 0, serviceRate: 0 });
    expect(totals.discount).toBe(0);
    expect(totals.tax).toBe(0);
    expect(totals.total).toBe(1000);
  });
});

describe("cart operations", () => {
  it("increments rather than duplicating when the same product is scanned twice", () => {
    let lines = addLine([], line());
    lines = addLine(lines, line({ id: "l2" }));

    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(2);
  });

  it("removes a line when its quantity reaches zero", () => {
    const lines = setQuantity([line()], "l1", 0);
    expect(lines).toHaveLength(0);
  });

  it("reports oversold lines without blocking them", () => {
    const over = oversoldLines([line({ quantity: 12, availableStock: 10 })]);
    expect(over).toHaveLength(1);
  });
});

describe("tender and change", () => {
  it("treats change as change, not revenue", () => {
    const tenders = [{ method: "cash", amount: 5000 }];
    expect(changeDue(3000, tenders)).toBe(2000);
    // A 50 note against a 30 basket is 30 taken, not 50.
    expect(amountPaid(3000, tenders)).toBe(3000);
  });

  it("supports split tender across methods", () => {
    const tenders = [
      { method: "cash", amount: 4000 },
      { method: "card", amount: 6000 },
    ];
    expect(balanceDue(10000, tenders)).toBe(0);
    expect(canComplete(10000, tenders, false).ok).toBe(true);
  });

  it("refuses a short walk-in sale because there is no account to carry it", () => {
    const verdict = canComplete(10000, [{ method: "cash", amount: 4000 }], false);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("60.00");
  });

  it("allows a short sale once a customer is attached", () => {
    expect(canComplete(10000, [{ method: "cash", amount: 4000 }], true).ok).toBe(true);
  });

  it("refuses an empty cart", () => {
    expect(canComplete(0, [], true).ok).toBe(false);
  });
});
