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
