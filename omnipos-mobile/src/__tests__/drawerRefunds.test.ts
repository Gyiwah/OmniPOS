import { readFileSync } from "node:fs";
import { join } from "node:path";

import migrations from "../database/migrations";
import wmSchema, { SCHEMA_VERSION } from "../database/wmSchema";

/**
 * A cash refund has to leave the drawer's expected figure.
 *
 * Expected cash is computed on the device by walking local orders and summing
 * the cash ones. Refunds were never subtracted, and the till has no local
 * returns table to subtract them from — so the money left the drawer and never
 * left the number.
 *
 * Demonstrated on a device before the fix: after one GHS 11 cash refund, a
 * drawer holding exactly the right money reported "Cash Short by -11.00". A
 * cashier is accused of losing money they handed back correctly, every time.
 *
 * The server was already right — it sums payments including the negative
 * refund — so the two disagreed and the till was the wrong one.
 */
describe("the drawer nets off refunds", () => {
  const shifts = readFileSync(join(process.cwd(), "src/features/shifts/service.ts"), "utf8");
  const returns = readFileSync(join(process.cwd(), "src/features/returns/service.ts"), "utf8");

  it("subtracts what was handed back before bucketing by method", () => {
    expect(shifts).toMatch(/const refunded = Math\.min\(Number\(o\.refundedAmount \?\? 0\), paid\)/);
    expect(shifts).toMatch(/const net = paid - refunded/);
    expect(shifts).toMatch(/cashSales \+= net/);
  });

  /** A refund cannot take out more than the sale brought in. */
  it("cannot drive a sale negative", () => {
    expect(shifts).toContain("Math.min(");
  });

  it("records the amount when a refund is processed", () => {
    expect(returns).toMatch(/rec\.refundedAmount = refundedSoFar/);
  });

  /**
   * From the refund just processed, not from totalRefunded — that is read back
   * through a Supabase query which returns nothing on a Laravel build, so it is
   * always zero. Its visible symptom was a fully refunded sale recorded as
   * "partially_refunded" with an amount of 0.00, which left the drawer wrong in
   * exactly the way this fix is meant to correct.
   */
  it("derives the amount from the refund itself, not a server read-back", () => {
    const block = returns.slice(returns.indexOf("const alreadyRefunded"));
    expect(block).toMatch(/\+ amount/);
  });
});

/**
 * The column that makes it possible, and the migration that adds it without
 * resetting a till holding unsynced sales.
 */
describe("orders carry what has been refunded", () => {
  it("declares the column", () => {
    expect(wmSchema.tables.orders.columns.refunded_amount).toBeDefined();
  });

  /** Most sales are never refunded; the column is absent for them. */
  it("keeps it optional", () => {
    expect(wmSchema.tables.orders.columns.refunded_amount.isOptional).toBe(true);
  });

  it("has a migration reaching the declared version", () => {
    expect(migrations.maxVersion).toBe(SCHEMA_VERSION);
    expect(migrations.sortedMigrations.map((m) => m.toVersion)).toContain(SCHEMA_VERSION);
  });
});
