import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isUuid, uuidv7 } from "@/src/core/ids";
import { buildProductRowForSupabase, resolveProductIdForImage } from "@/src/sync/productRow";

/**
 * Guards the core identity invariant introduced with client-minted UUIDs:
 *
 *   a record's local primary key IS its server primary key
 *
 * The sync engine branches on `isUuid(localId)` to decide whether an id can be
 * used directly against the server. Before client-minted ids, locally generated
 * WatermelonDB ids were never UUIDs, so that check was implicitly safe. Now that
 * every local id is a UUIDv7, the check is only safe while every pulled row
 * adopts the server id as its local primary key — otherwise `resolveRemoteProductId`
 * would hand a local id to the server and produce orphaned or FK-violating writes.
 */
describe("local id === server id invariant", () => {
  it("treats a freshly minted local id as usable against the server", () => {
    const localId = uuidv7();
    expect(isUuid(localId)).toBe(true);
    expect(resolveProductIdForImage({ id: localId })).toBe(localId);
  });

  it("carries the client id through to the row pushed to the server", () => {
    const id = uuidv7();
    const row = buildProductRowForSupabase("store-1", { id, name: "Widget", sku: "W-1", sell_price: 5 });
    expect(row.id).toBe(id);
  });

  it("every pull path adopts the server id as the local primary key", () => {
    const source = readFileSync(join(process.cwd(), "src/sync/syncEngine.ts"), "utf8");

    // Each `pull*` function creates local rows for server rows it has not seen.
    // Every one of those create() calls must claim the server id.
    const createCalls = source.match(/await \w+Col\.create\(\(rec\) => \{[\s\S]*?\n {8}\}\)/g) ?? [];
    expect(createCalls.length).toBeGreaterThanOrEqual(3);

    for (const call of createCalls) {
      expect(call).toContain("rec._raw.id = row.id;");
    }
  });
});
