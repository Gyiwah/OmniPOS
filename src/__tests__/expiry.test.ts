import { describe, it } from "node:test";
import assert from "node:assert";
import { calculateExpiryStatus } from "../features/inventory/expiryUtils";

describe("batch expiry calculation", () => {
  it("returns no_expiry for empty or invalid dates", () => {
    assert.strictEqual(calculateExpiryStatus(null).status, "no_expiry");
    assert.strictEqual(calculateExpiryStatus("").status, "no_expiry");
    assert.strictEqual(calculateExpiryStatus("invalid-date").status, "no_expiry");
  });

  it("detects expired dates correctly", () => {
    const past = new Date();
    past.setDate(past.getDate() - 10);
    const result = calculateExpiryStatus(past.toISOString().slice(0, 10));
    assert.strictEqual(result.status, "expired");
    assert.ok(result.daysRemaining !== null && result.daysRemaining < 0);
  });

  it("detects expiring soon within threshold", () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 15);
    const result = calculateExpiryStatus(soon.toISOString().slice(0, 10), 30);
    assert.strictEqual(result.status, "expiring_soon");
    assert.ok(result.daysRemaining !== null && result.daysRemaining >= 0 && result.daysRemaining <= 30);
  });

  it("detects good expiry date far in future", () => {
    const future = new Date();
    future.setDate(future.getDate() + 90);
    const result = calculateExpiryStatus(future.toISOString().slice(0, 10), 30);
    assert.strictEqual(result.status, "good");
    assert.ok(result.daysRemaining !== null && result.daysRemaining > 30);
  });
});
