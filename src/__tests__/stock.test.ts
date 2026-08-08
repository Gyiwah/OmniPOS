import { canIncreaseQuantity, validateCartQuantities } from "../features/orders/stock";

describe("stock logic", () => {
  it("allows increasing quantity when current stock exceeds cart quantity", () => {
    const line = { id: "p1", name: "Widget", price: 10, quantity: 2 };
    const stockById = new Map([["p1", 5]]);
    expect(canIncreaseQuantity(line, stockById)).toBe(true);
  });

  it("prevents increasing quantity when cart quantity reaches stock limit", () => {
    const line = { id: "p1", name: "Widget", price: 10, quantity: 5 };
    const stockById = new Map([["p1", 5]]);
    expect(canIncreaseQuantity(line, stockById)).toBe(false);
  });

  it("validates cart quantities without throwing when stock is sufficient", () => {
    const lines = [
      { id: "p1", name: "Widget A", price: 10, quantity: 2 },
      { id: "p2", name: "Widget B", price: 20, quantity: 1 },
    ];
    const stockById = new Map([
      ["p1", 10],
      ["p2", 5],
    ]);

    expect(() => validateCartQuantities(lines, stockById)).not.toThrow();
  });

  it("throws InsufficientStockError when requested quantity exceeds available stock", () => {
    const lines = [{ id: "p1", name: "Widget A", price: 10, quantity: 5 }];
    const stockById = new Map([["p1", 2]]);

    expect(() => validateCartQuantities(lines, stockById)).toThrow(/Insufficient stock/);
  });
});
