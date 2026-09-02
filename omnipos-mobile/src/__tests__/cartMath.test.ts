import { calculateCartTotals } from "../utils/cartMath";

describe("calculateCartTotals", () => {
  it("calculates standard subtotal with no discounts or taxes", () => {
    const res = calculateCartTotals({
      lines: [
        { price: 10, quantity: 2 },
        { price: 5, quantity: 4 },
      ],
      discountMode: "amount",
      discountValue: 0,
      amountPaid: 40,
    });

    expect(res.subtotal).toBe(40);
    expect(res.discountAmount).toBe(0);
    expect(res.total).toBe(40);
    expect(res.change).toBe(0);
    expect(res.balance).toBe(0);
  });

  it("calculates percentage discount correctly", () => {
    const res = calculateCartTotals({
      lines: [{ price: 100, quantity: 1 }],
      discountMode: "percentage",
      discountValue: 10,
      amountPaid: 100,
    });

    expect(res.subtotal).toBe(100);
    expect(res.discountAmount).toBe(10);
    expect(res.taxedBase).toBe(90);
    expect(res.total).toBe(90);
    expect(res.change).toBe(10);
  });

  it("calculates taxes, VAT, and service rates", () => {
    const res = calculateCartTotals({
      lines: [{ price: 100, quantity: 1 }],
      discountMode: "amount",
      discountValue: 0,
      taxRate: 5,
      vatRate: 10,
      serviceRate: 2,
      amountPaid: 120,
    });

    expect(res.subtotal).toBe(100);
    expect(res.tax).toBe(5);
    expect(res.vat).toBe(10);
    expect(res.service).toBe(2);
    expect(res.total).toBe(117);
    expect(res.change).toBe(3);
  });

  it("handles overpayment and calculates change due", () => {
    const res = calculateCartTotals({
      lines: [{ price: 25, quantity: 2 }],
      discountMode: "amount",
      discountValue: 0,
      amountPaid: 100,
    });

    expect(res.total).toBe(50);
    expect(res.change).toBe(50);
    expect(res.balance).toBe(0);
  });

  it("handles underpayment and calculates balance due", () => {
    const res = calculateCartTotals({
      lines: [{ price: 50, quantity: 2 }],
      discountMode: "amount",
      discountValue: 0,
      amountPaid: 40,
    });

    expect(res.total).toBe(100);
    expect(res.change).toBe(0);
    expect(res.balance).toBe(60);
  });
});

/**
 * The chips a cashier taps instead of typing what they were handed.
 *
 * The row rendered "Exact (₵11.22) ₵20 ₵20 ₵50 ₵100" — the same note twice,
 * because the 10 and 20 steps both round an 11.22 sale up to 20 and nothing
 * removed the collision. Two identical buttons side by side read as a
 * rendering fault, and a cashier hesitating mid-sale is the actual cost.
 */
import { tenderSuggestions } from "../utils/cartMath";

describe("tenderSuggestions", () => {
  it("never offers the same note twice", () => {
    for (const total of [11.22, 45, 1, 9.99, 20.01, 50.5, 99, 100.01]) {
      const amounts = tenderSuggestions(total);
      expect(amounts).toStrictEqual([...new Set(amounts)]);
    }
  });

  /** The exact amount has its own chip; these are for what a customer hands over. */
  it("offers nothing at or below the amount due", () => {
    for (const total of [11.22, 20, 45, 100]) {
      for (const amount of tenderSuggestions(total)) {
        expect(amount).toBeGreaterThan(total);
      }
    }
  });

  it("rounds up to notes a cashier is actually handed", () => {
    expect(tenderSuggestions(11.22)).toStrictEqual([20, 50, 100]);

    // 60 is three twenties, which is a real way to pay for a 45 sale — the
    // steps are note sizes, not a fixed menu of round numbers.
    expect(tenderSuggestions(45)).toStrictEqual([50, 60, 100]);
  });

  /** Ascending, so the row does not jump about between sales. */
  it("is ordered", () => {
    const amounts = tenderSuggestions(37.5);
    expect(amounts).toStrictEqual([...amounts].sort((a, b) => a - b));
  });

  /** An empty cart has nothing to tender against. */
  it("offers nothing for a total of zero", () => {
    expect(tenderSuggestions(0)).toStrictEqual([]);
    expect(tenderSuggestions(Number.NaN)).toStrictEqual([]);
  });
});
