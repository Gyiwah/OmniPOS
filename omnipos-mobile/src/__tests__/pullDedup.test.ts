import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Applying a pull that mentions the same record more than once.
 *
 * A changefeed carries a row per write, so a product edited twice arrives
 * twice in one page. applyChanges decides create-or-update from a map of what
 * the database already holds, built once before the loop and never updated as
 * creates are queued — so a repeated record took the create path every time and
 * one batch ended up with two inserts for the same primary key:
 *
 *   SQLiteConstraintException: UNIQUE constraint failed: products.id
 *
 * The whole pull died on it. Nothing synced, the till showed "Not synced yet"
 * indefinitely, and every retry rebuilt the identical doomed batch.
 *
 * It only became reachable once the database persisted: while the till ran on
 * an in-memory adapter that reset on each launch, a collision inside a single
 * batch was the only way to hit it, and a fresh empty database hid the rest.
 *
 * Read from source because exercising it for real needs the native SQLite
 * adapter this code is written against.
 */
describe("a pull that repeats a record", () => {
  const source = readFileSync(join(process.cwd(), "src/sync/laravelSync.ts"), "utf8");

  it("collapses changes to one per record before applying them", () => {
    expect(source).toContain("latestPerRecord");
    expect(source).toMatch(/productChanges\s*=\s*latestPerRecord\(/);
    expect(source).toMatch(/customerChanges\s*=\s*latestPerRecord\(/);
  });

  /** Last wins: the feed is ordered, so the newest change is current state. */
  it("keeps the newest change, not the first", () => {
    const fn = source.slice(source.indexOf("function latestPerRecord"));
    expect(fn).toMatch(/byId\.set\(change\.record_id, change\)/);
    expect(fn).not.toMatch(/if \(byId\.has\(/);
  });
});

/**
 * The helper's behaviour, independently of the file it lives in. Kept as a
 * local copy because the module imports the native database.
 */
describe("latestPerRecord semantics", () => {
  function latestPerRecord<T extends { record_id: string }>(list: T[]): T[] {
    const byId = new Map<string, T>();
    for (const change of list) byId.set(change.record_id, change);
    return [...byId.values()];
  }

  it("returns one entry per record", () => {
    const out = latestPerRecord([
      { record_id: "a", v: 1 },
      { record_id: "b", v: 2 },
      { record_id: "a", v: 3 },
    ]);

    expect(out).toHaveLength(2);
  });

  it("keeps the last occurrence", () => {
    const out = latestPerRecord([
      { record_id: "a", v: 1 },
      { record_id: "a", v: 3 },
    ]);

    expect(out[0].v).toBe(3);
  });

  it("leaves a list with no repeats alone", () => {
    const input = [{ record_id: "a" }, { record_id: "b" }];
    expect(latestPerRecord(input)).toStrictEqual(input);
  });
});
