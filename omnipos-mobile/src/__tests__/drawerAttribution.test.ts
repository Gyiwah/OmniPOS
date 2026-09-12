import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A sale has to say which drawer took the money.
 *
 * The server hangs each payment off its order's register_shift_id, and
 * computeExpectedCash sums the cash payments attached to a shift. The mobile
 * order payload never sent one, so every sale from a till arrived unattached:
 * 28 payments in a test database with no shift at all.
 *
 * The consequence only appears at closing time, which is the worst moment to
 * find it. A shift's expected cash was its opening float and nothing else, so
 * the count came out over by the entire day's takings — and a cashier who is
 * told the drawer is over by a day's cash has no way to tell that from real
 * money going missing in the other direction.
 *
 * The web till had been sending it throughout; only mobile had not.
 */
describe("a sale names the drawer that took the money", () => {
  const checkout = readFileSync(join(process.cwd(), "src/app/pos/order-info.tsx"), "utf8");

  it("sends register_shift_id with the order", () => {
    expect(checkout).toMatch(/register_shift_id: activeShift\?\.id \?\? null/);
  });

  it("reads the open shift from the same source the rest of the till does", () => {
    expect(checkout).toContain("useActiveShift");
  });

  /**
   * Null when no drawer is open, rather than omitted. A sale can legitimately
   * happen with the register closed, and the server stores null for it — what
   * it must not do is silently attach it to some other shift.
   */
  it("sends null rather than nothing when no shift is open", () => {
    expect(checkout).toMatch(/activeShift\?\.id \?\? null/);
  });
});
