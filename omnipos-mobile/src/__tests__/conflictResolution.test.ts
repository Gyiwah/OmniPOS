import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the one rule conflict resolution cannot break.
 *
 * On this client the sync_queue row's own id IS the operation_id sent to the
 * server, and the server remembers every id it has seen — including the ones it
 * rejected. So re-pushing a corrected payload under the original row hits the
 * idempotency short-circuit: the server answers "duplicate" from the stored
 * conflict result and applies nothing, the client deletes the row believing it
 * succeeded, and the sale is gone. Money taken, receipt printed, nothing on the
 * books — and it looks exactly like success.
 *
 * The protection is structural: resolving destroys the row and creates a new
 * one. This test reads the source because the failure mode is a one-line edit
 * ("just set status back to pending") that no runtime test would obviously
 * catch, and that reviewers have to be told to look for.
 */
describe("resolving a conflict never reuses an operation id", () => {
  const source = readFileSync(join(process.cwd(), "src/sync/laravelResolve.ts"), "utf8");

  it("re-queues by destroying the row and creating a fresh one", () => {
    const requeue = source.match(/async function requeue\([\s\S]*?\n\}/)?.[0];

    expect(requeue).toBeDefined();
    expect(requeue).toContain("destroyPermanently()");
    expect(requeue).toContain('.create((rec) => {');
    expect(requeue).toContain('rec.status = "pending"');
  });

  it("never revives a rejected row in place", () => {
    // `row.update(... status = "pending" ...)` is the exact edit that reuses the
    // id. Nothing in this file may set a queue row back to pending except the
    // create() inside requeue.
    const updatesToPending = source.match(/\.update\(\([\s\S]{0,200}?status\s*=\s*"pending"/g) ?? [];

    expect(updatesToPending).toEqual([]);
  });

  it("discards without deleting the sale itself", () => {
    const discard = source.match(/export async function discardOperation\([\s\S]*?\n\}/)?.[0];

    expect(discard).toBeDefined();
    // The queue row goes; the order stays, marked. Someone took money against it
    // and may hold a receipt — erasing it leaves nothing to investigate.
    expect(discard).toContain('rec.status = "discarded"');
    expect(discard).not.toMatch(/order\.destroyPermanently/);
  });

  it("re-issues a receipt number inside the clashed number's own date prefix", () => {
    const free = source.match(/async function freeReceiptNumber\([\s\S]*?\n\}/)?.[0];

    expect(free).toBeDefined();
    // Asking the server first is what makes the new number free across every
    // till, not just this one.
    expect(free).toContain("/api/orders/next-number");
    // The local fallback must derive its prefix from the clashed number. Using
    // today's instead compares sequences across different days, which is
    // meaningless and can propose the same number twice running.
    expect(free).toContain("clashedWith.slice(0, clashedWith.lastIndexOf(\"-\") + 1)");
  });
});
