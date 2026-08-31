import { calculateExpiryStatus } from "../features/inventory/expiryUtils";

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
    expect(result.daysRemaining).not.toBeNull();
    expect(result.daysRemaining as number).toBeLessThan(0);
  });

  it("detects expiring soon within threshold", () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 15);
    const result = calculateExpiryStatus(soon.toISOString().slice(0, 10), 30);
    expect(result.status).toBe("expiring_soon");
    expect(result.daysRemaining).not.toBeNull();
    expect(result.daysRemaining as number).toBeGreaterThanOrEqual(0);
    expect(result.daysRemaining as number).toBeLessThanOrEqual(30);
  });

  it("detects good expiry date far in future", () => {
    const future = new Date();
    future.setDate(future.getDate() + 90);
    const result = calculateExpiryStatus(future.toISOString().slice(0, 10), 30);
    expect(result.status).toBe("good");
    expect(result.daysRemaining).not.toBeNull();
    expect(result.daysRemaining as number).toBeGreaterThan(30);
  });
});
