import {
  canIncreaseQuantity,
  InsufficientStockError,
  validateCartQuantities,
} from "../features/orders/stock";
import { calculateExpiryStatus } from "../features/inventory/batchService";

describe("stock logic", () => {
  it("allows increasing quantity when current stock exceeds cart quantity", () => {
    const line = { id: "p1", name: "Widget", price: 10, quantity: 2 };
    const stockById = new Map([["p1", 5]]);
    expect(canIncreaseQuantity(line.id, line.quantity + 1, stockById)).toBe(true);
  });

  it("prevents increasing quantity when cart quantity reaches stock limit", () => {
    const line = { id: "p1", name: "Widget", price: 10, quantity: 5 };
    const stockById = new Map([["p1", 5]]);
    expect(canIncreaseQuantity(line.id, line.quantity + 1, stockById)).toBe(false);
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

    expect(() => validateCartQuantities(lines, stockById)).toThrow(InsufficientStockError);
    expect(() => validateCartQuantities(lines, stockById)).toThrow(
      '"Widget A" only has 2 in stock (requested 5).',
    );
  });
});

describe("batch expiry calculation", () => {
  it("returns no_expiry for empty or invalid dates", () => {
    expect(calculateExpiryStatus(null).status).toBe("no_expiry");
    expect(calculateExpiryStatus("").status).toBe("no_expiry");
    expect(calculateExpiryStatus("invalid-date").status).toBe("no_expiry");
  });

  it("detects expired dates correctly", () => {
    const past = new Date();
    past.setDate(past.getDate() - 10);
    const result = calculateExpiryStatus(past.toISOString().slice(0, 10));
    expect(result.status).toBe("expired");
    expect(result.daysRemaining).toBeLessThan(0);
  });

  it("detects expiring soon within threshold", () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 15);
    const result = calculateExpiryStatus(soon.toISOString().slice(0, 10), 30);
    expect(result.status).toBe("expiring_soon");
    expect(result.daysRemaining).toBeGreaterThanOrEqual(0);
    expect(result.daysRemaining).toBeLessThanOrEqual(30);
  });

  it("detects good expiry date far in future", () => {
    const future = new Date();
    future.setDate(future.getDate() + 90);
    const result = calculateExpiryStatus(future.toISOString().slice(0, 10), 30);
    expect(result.status).toBe("good");
    expect(result.daysRemaining).toBeGreaterThan(30);
  });
});

