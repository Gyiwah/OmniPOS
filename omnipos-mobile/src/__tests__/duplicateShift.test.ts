import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Two open drawers for one cashier, and the till never finding out.
 *
 * The server refuses a second open shift for a cashier. When it did, nothing
 * told the till: the rejection sat in the outbox as a conflict while the till
 * carried on selling, attributing and reconciling against a shift the server
 * did not have.
 *
 * Everything downstream was built on it. Sales landed with no drawer attached,
 * the close created a half-formed record with no opening float, and the
 * Z-report reconciled against an expected figure the server computed as zero.
 * All observed on a device, from a shift opened ten days earlier and never
 * closed.
 *
 * Checked from source: exercising it needs a server and the native database.
 */
describe("a cashier cannot open a second drawer", () => {
  const shifts = readFileSync(join(process.cwd(), "src/features/shifts/service.ts"), "utf8");

  it("asks the server before opening one locally", () => {
    expect(shifts).toContain("/api/register-shifts/current");

    const open = shifts.slice(shifts.indexOf("export async function openShift"));
    const ask = open.indexOf("serverOpenShift");
    const create = open.indexOf('.create((rec)');

    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(create);
  });

  /**
   * Adopted, not refused. The cashier wants a drawer open and there is one —
   * theirs. Handing it back makes the till and server agree from the first
   * sale rather than diverging until somebody counts the money.
   */
  it("adopts the server's drawer with its real opening float", () => {
    expect(shifts).toMatch(/rec\._raw\.id = remote\.id/);
    expect(shifts).toMatch(/rec\.openingFloat = remote\.openingFloat/);
  });

  /** It is already on the server; pushing it back would only conflict. */
  it("does not queue the adopted shift for the server", () => {
    const adopt = shifts.slice(shifts.indexOf("const remote = await serverOpenShift"));
    const upTo = adopt.slice(0, adopt.indexOf("return remote;"));

    expect(upTo).toMatch(/rec\.dirty = false/);
    expect(upTo).not.toContain("enqueueChange");
  });

  /**
   * A till with no connection must still open a drawer. That is the whole
   * premise of the app, and it outranks preventing a duplicate.
   */
  it("still opens locally when the server cannot be reached", () => {
    const fn = shifts.slice(shifts.indexOf("async function serverOpenShift"));
    expect(fn).toMatch(/catch/);
    expect(fn).toMatch(/return null/);
  });

  /** Supabase builds have no such endpoint. */
  it("only asks on a Laravel build", () => {
    expect(shifts).toMatch(/if \(!usingLaravel\) return null/);
  });
});
