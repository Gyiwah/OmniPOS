import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Who owns products.stock on a Laravel build: the server, from the ledger.
 *
 * The sale and return paths update the local figure so the next customer sees a
 * truthful number, then push the stock_movements that caused it. They must NOT
 * also push the products row.
 *
 * They did. The guard that says so existed, with a comment explaining exactly
 * why the push is harmful — and it sat one block BELOW the push it was meant to
 * prevent. Two things followed, and only the first was visible:
 *
 *   1. A cashier may not edit the catalogue, so the server refused every one of
 *      these with "Your role does not permit this operation." Every sale left a
 *      rejected item in the outbox and a prompt to go and settle it. An alarm
 *      that fires on every sale is one nobody reads, and genuine conflicts —
 *      duplicate receipt numbers, over-refunds — arrive in the same list.
 *
 *   2. A manager's role DOES permit it. No refusal, and an absolute stock
 *      quantity written over ledger-derived stock: the last-writer-wins race
 *      the ledger exists to remove.
 *
 * Read from source because the property is structural — the ordering of a guard
 * against a push — and observable only by watching what a real till queues.
 */
describe("the server owns stock on a Laravel build", () => {
  const source = readFileSync(join(process.cwd(), "src/features/orders/stock.ts"), "utf8");

  /** Every catalogue push must be preceded by the transport guard. */
  it("never queues a products push after the Laravel guard has been passed", () => {
    const guards = [...source.matchAll(/if \(usingLaravel\) return;/g)].map((m) => m.index ?? 0);
    const pushes = [...source.matchAll(/entity: "products"/g)].map((m) => m.index ?? 0);

    expect(guards.length).toBeGreaterThan(0);
    expect(pushes.length).toBeGreaterThan(0);

    for (const push of pushes) {
      const guardBefore = guards.some((g) => g < push);
      expect(guardBefore).toBe(true);
    }
  });

  /**
   * The stock figure still has to move locally. A till that waited for the
   * server to confirm before showing the new count would show the old one to
   * the next customer in the queue.
   */
  it("still records the movement that caused the change", () => {
    expect(source).toContain("recordStockMovement");
    expect(source).toMatch(/type: "SALE"/);
    expect(source).toMatch(/type: "RETURN"/);
  });
});
