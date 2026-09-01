import { describe, expect, it } from "vitest";

import type { LocalProduct } from "@/db/schema";
import { mapColumns, parseCsv, planImport, summarise } from "./csvImport";
import { inventoryToCsv } from "./exportCsv";

function product(over: Partial<LocalProduct> = {}): LocalProduct {
  return {
    id: "p", store_id: "s", category_id: null, name: "Meat Pie", sku: "MP-1",
    barcode: null, price: "8.00", cost_price: "4.50", stock: 10, reorder_level: 5,
    image_url: null, tags: [], is_active: true, updated_at: "", search_key: "meat pie mp-1",
    ...over,
  };
}

describe("the CSV parser", () => {
  /**
   * The failure that motivated writing a real parser: splitting on commas
   * shifts every column after the first product called "Rice, 5kg", which puts
   * a price into a stock field without anything looking wrong.
   */
  it("keeps a quoted field containing a comma in one cell", () => {
    const rows = parseCsv('Name,Price\n"Rice, 5kg",42.00');

    expect(rows[1]).toEqual(["Rice, 5kg", "42.00"]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('Name\n"Rice ""Gold"""')[1]).toEqual(['Rice "Gold"']);
  });

  it("handles a newline inside a quoted field", () => {
    const rows = parseCsv('Name,Note\n"Bread","Two\nlines"');

    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe("Two\nlines");
  });

  it("reads CRLF without emitting blank rows", () => {
    expect(parseCsv("A,B\r\n1,2\r\n")).toEqual([["A", "B"], ["1", "2"]]);
  });

  /** Excel writes one, and it would otherwise break the first header match. */
  it("strips a byte order mark", () => {
    expect(parseCsv("﻿Name,Price\nBread,3")[0][0]).toBe("Name");
  });

  it("drops entirely empty rows", () => {
    expect(parseCsv("A,B\n1,2\n\n,\n3,4")).toHaveLength(3);
  });
});

describe("column matching", () => {
  it("finds columns whatever they are called and in any order", () => {
    const map = mapColumns(["Barcode", "Product Title", "Retail Price", "Item Code", "Qty on hand"]);

    expect(map.barcode).toBe(0);
    expect(map.name).toBe(1);
    expect(map.price).toBe(2);
    expect(map.sku).toBe(3);
    expect(map.stock).toBe(4);
  });

  /**
   * "Cost Price" contains "price". Without claiming cost first, the sell column
   * matches the cost header and every product imports at its wholesale price —
   * which a shop would discover at the till, one sale at a time.
   */
  it("does not let the cost column be taken as the sell price", () => {
    const map = mapColumns(["Name", "Cost Price", "Sell Price"]);

    expect(map.cost).toBe(1);
    expect(map.price).toBe(2);
  });
});

describe("planning an import", () => {
  const existing = [product({ sku: "MP-1", name: "Meat Pie" })];

  it("marks a known SKU as an update and an unknown one as new", () => {
    const rows = planImport(parseCsv("Name,SKU,Price\nMeat Pie,MP-1,9.00\nBread,BR-1,15.00"), existing);

    expect(rows.map((r) => r.action)).toEqual(["update", "create"]);
  });

  it("matches an existing SKU regardless of case", () => {
    const rows = planImport(parseCsv("Name,SKU,Price\nMeat Pie,mp-1,9.00"), existing);

    expect(rows[0].action).toBe("update");
  });

  it("converts prices to minor units", () => {
    const rows = planImport(parseCsv("Name,SKU,Price,Cost\nBread,BR-1,15.50,9.25"), []);

    expect(rows[0].price).toBe(1550);
    expect(rows[0].cost).toBe(925);
  });

  it("tolerates currency symbols and thousands separators", () => {
    const rows = planImport(parseCsv("Name,SKU,Price\nTV,TV-1,\"GHS 1,299.00\""), []);

    expect(rows[0].price).toBe(129900);
  });

  /**
   * Kept and shown rather than dropped. An importer that quietly discards the
   * rows it did not like leaves a shop believing it has a full catalogue.
   */
  it("keeps a broken row and says what is wrong with it", () => {
    const rows = planImport(parseCsv("Name,SKU,Price\n,X-1,5.00\nBread,BR-1,"), []);

    expect(rows[0]).toMatchObject({ action: "skip", problem: "No product name" });
    expect(rows[1]).toMatchObject({ action: "skip", problem: "No price" });
  });

  it("catches a SKU repeated within the file itself", () => {
    const rows = planImport(parseCsv("Name,SKU,Price\nBread,BR-1,15\nBuns,BR-1,12"), []);

    expect(rows[1].problem).toBe("SKU BR-1 is also on line 2");
    expect(rows[1].action).toBe("skip");
  });

  it("invents a SKU when the file has none", () => {
    const rows = planImport(parseCsv("Name,Price\nGinger Biscuits,3.50"), []);

    expect(rows[0].sku).toMatch(/^GINGER-BISCU-/);
    expect(rows[0].action).toBe("create");
  });

  it("counts what will happen", () => {
    const rows = planImport(
      parseCsv("Name,SKU,Price,Stock\nMeat Pie,MP-1,9,5\nBread,BR-1,15,20\n,X,1,1"),
      existing,
    );

    // Only the new product's stock becomes an opening movement.
    expect(summarise(rows)).toEqual({ create: 1, update: 1, skip: 1, opening: 1 });
  });
});

describe("the round trip", () => {
  /**
   * Export then import has to survive the awkward names, because the file a
   * shop most often re-imports is one this app produced.
   */
  it("reads back a file this app exported, commas and quotes intact", () => {
    const csv = inventoryToCsv(
      [
        { product: product({ name: 'Rice, 5kg "Gold"', sku: "RC-1", price: "42.00", stock: 7 }), expiry: null },
        { product: product({ name: "Bread", sku: "BR-1", price: "15.00", stock: 3 }), expiry: null },
      ],
      "GHS",
    );

    const rows = planImport(parseCsv(csv), []);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Rice, 5kg "Gold"', sku: "RC-1", price: 4200, stock: 7 });
    expect(rows[1]).toMatchObject({ name: "Bread", sku: "BR-1", price: 1500 });
    expect(rows.every((r) => r.problem === null)).toBe(true);
  });
});
