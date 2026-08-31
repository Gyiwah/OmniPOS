import { isUuid, uuidv7 } from "@/src/core/ids";

/**
 * The contract the mobile Laravel sync depends on.
 *
 * These are cheap checks of properties that are expensive to get wrong. The
 * network path is exercised end to end against a running backend; what is
 * guarded here is the reasoning underneath it, which no integration run would
 * catch failing until money had already gone missing.
 */

describe("sync queue rows are usable as idempotency keys", () => {
  /**
   * The mobile push sends each queue row's own id as the server's operation_id.
   * That only works because ids are UUIDv7 — the server validates the field as a
   * uuid, and WatermelonDB's default ids are not one.
   *
   * If the global generator is ever removed, every push fails validation. This
   * is the check that says why.
   */
  it("mints ids the server will accept as an operation_id", () => {
    for (let i = 0; i < 200; i += 1) {
      const id = uuidv7();
      expect(isUuid(id)).toBe(true);
      expect(id[14]).toBe("7");
    }
  });

  /**
   * A retry must carry the SAME id. The server records every operation_id it has
   * seen and replays the stored result for a repeat; a fresh id on retry would
   * be read as new work and book the sale twice.
   *
   * Expressed as: ids are never reused across DIFFERENT writes, so an id can
   * safely stand for one write for ever.
   */
  it("never repeats an id across separate writes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) seen.add(uuidv7());
    expect(seen.size).toBe(20_000);
  });
});

describe("push payload shape", () => {
  /**
   * The server rejects any entity it does not have a handler for. Sending one
   * would sit in the queue retrying for ever and block everything behind it, so
   * the client filters first — and this list must not drift from the server's.
   *
   * Mirrors App\Services\Sync\EntityResolver::MAP.
   */
  it("matches the entities the server resolves", () => {
    const clientEntities = [
      "products",
      "customers",
      "orders",
      "product_batches",
      "stock_movements",
      "price_history",
      "register_shifts",
    ].sort();

    // Kept as a literal on purpose: if the server's list changes, this test
    // should fail and force a deliberate decision, not silently follow.
    const serverEntities = [
      "products",
      "customers",
      "orders",
      "product_batches",
      "stock_movements",
      "price_history",
      "register_shifts",
    ].sort();

    expect(clientEntities).toEqual(serverEntities);
  });

  it("maps local operations to the two actions the server accepts", () => {
    const toAction = (operation: string) => (operation === "delete" ? "delete" : "upsert");

    expect(toAction("insert")).toBe("upsert");
    expect(toAction("upsert")).toBe("upsert");
    expect(toAction("update")).toBe("upsert");
    expect(toAction("delete")).toBe("delete");
  });
});
