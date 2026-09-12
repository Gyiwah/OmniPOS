import migrations from "../database/migrations";
import wmSchema, { SCHEMA_VERSION } from "../database/wmSchema";

/**
 * The schema and its migrations have to agree, or a till loses its data.
 *
 * WatermelonDB migrates an existing database from the version on disk up to
 * the version in code. If the schema is bumped and no migration reaches it,
 * the adapter cannot find a path and resets the database instead — on an
 * offline-first till that means discarding sales that have not yet been
 * pushed. Money, gone, on the next app start after an update.
 *
 * It is a one-line mistake to make and invisible until someone upgrades with
 * unsynced takings, so it is asserted rather than remembered.
 */
describe("schema and migrations agree", () => {
  const versions = migrations.sortedMigrations.map((m) => m.toVersion);
  const highest = migrations.maxVersion;

  it("has a migration that reaches the current schema version", () => {
    expect(versions).toContain(SCHEMA_VERSION);
  });

  it("never declares a schema older than its newest migration", () => {
    expect(SCHEMA_VERSION).toBe(highest);
  });

  it("leaves no gap in the upgrade path", () => {
    const sorted = [...versions].sort((a, b) => a - b);

    // Migrations start at 2: version 1 is the original schema.
    expect(sorted[0]).toBe(2);

    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]).toBe(sorted[i - 1] + 1);
    }
  });

  it("declares each version exactly once", () => {
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("matches the version the schema object reports", () => {
    expect(wmSchema.version).toBe(SCHEMA_VERSION);
  });
});

/**
 * The columns added at version 7, checked against the schema the app will
 * actually open — a migration that adds a column the schema does not declare
 * leaves the table and the model disagreeing.
 */
describe("stock_movements carries its source", () => {
  const table = wmSchema.tables.stock_movements;

  it("declares both source columns", () => {
    expect(table.columns.source_type).toBeDefined();
    expect(table.columns.source_id).toBeDefined();
  });

  /** Rows written before this existed have no cause to name. */
  it("keeps them optional", () => {
    expect(table.columns.source_type.isOptional).toBe(true);
    expect(table.columns.source_id.isOptional).toBe(true);
  });

  /** The question asked of it is "what moved because of this sale". */
  it("indexes the id that gets looked up", () => {
    expect(table.columns.source_id.isIndexed).toBe(true);
  });
});
