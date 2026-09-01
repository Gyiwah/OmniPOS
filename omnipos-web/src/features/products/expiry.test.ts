import { describe, expect, it } from "vitest";

import type { LocalBatch, LocalProduct } from "@/db/schema";
import { countByFilter, expiryStatus, matchesFilter, matchesQuery, worstBatchExpiry } from "./expiry";
import { inventoryToCsv } from "./exportCsv";
import { suggestBatchNumber } from "./service";

const TODAY = new Date("2026-09-01T14:30:00Z");

function batch(expiry: string | null, quantity = 10): LocalBatch {
  return {
    id: `b-${expiry}-${quantity}`, store_id: "s", product_id: "p",
    batch_number: "B1", quantity: String(quantity), cost_price: null,
    expiry_date: expiry, _state: "clean",
  };
}

function product(over: Partial<LocalProduct> = {}): LocalProduct {
  return {
    id: "p", store_id: "s", category_id: null, name: "Meat Pie", sku: "MP-1",
    barcode: "5012345", price: "8.00", cost_price: "4.50", stock: 10,
    reorder_level: 5, image_url: null, tags: [], is_active: true,
    updated_at: "", search_key: "meat pie mp-1", ...over,
  };
}

describe("expiry status", () => {
  /**
   * The boundary that matters: a batch that expires today is still sellable at
   * nine in the morning. Comparing timestamps rather than dates would call it
   * expired for most of its last day.
   */
  it("treats the expiry day itself as not yet expired", () => {
    const info = expiryStatus("2026-09-01", TODAY);
    expect(info.status).toBe("expiring_soon");
    expect(info.label).toBe("Expires today");
  });

  it("is expired the day after", () => {
    expect(expiryStatus("2026-08-31", TODAY)).toMatchObject({ status: "expired", label: "Expired 1 day ago" });
  });

  it("warns inside thirty days and not outside", () => {
    expect(expiryStatus("2026-10-01", TODAY).status).toBe("expiring_soon");
    expect(expiryStatus("2026-10-02", TODAY).status).toBe("good");
  });

  it("says tomorrow rather than 'in 1 days'", () => {
    expect(expiryStatus("2026-09-02", TODAY).label).toBe("Expires tomorrow");
  });

  it("reports no expiry for a blank or unparseable date", () => {
    expect(expiryStatus(null, TODAY).status).toBe("no_expiry");
    expect(expiryStatus("   ", TODAY).status).toBe("no_expiry");
    expect(expiryStatus("not a date", TODAY).status).toBe("no_expiry");
  });
});

describe("a product's worst batch", () => {
  it("reports the worst status, not the earliest date", () => {
    const info = worstBatchExpiry([batch("2026-10-15"), batch("2026-08-01")], TODAY);
    expect(info?.status).toBe("expired");
  });

  /**
   * A lot that expired last month but has nothing left in it is not a problem
   * on the shelf, and flagging it trains people to ignore the flag.
   */
  it("ignores a batch that is empty", () => {
    expect(worstBatchExpiry([batch("2026-08-01", 0)], TODAY)).toBeNull();
  });

  it("prefers the sooner of two batches with the same status", () => {
    const info = worstBatchExpiry([batch("2026-09-20"), batch("2026-09-05")], TODAY);
    expect(info?.label).toBe("Expires in 4 days");
  });

  it("is null when nothing has an expiry date", () => {
    expect(worstBatchExpiry([batch(null)], TODAY)).toBeNull();
  });
});

describe("filters", () => {
  const rows = [
    { product: product({ id: "a", stock: 10, reorder_level: 5 }), expiry: null },
    { product: product({ id: "b", stock: 3, reorder_level: 5 }), expiry: null },
    { product: product({ id: "c", stock: 0, reorder_level: 5 }), expiry: null },
    { product: product({ id: "d", stock: 8 }), expiry: expiryStatus("2026-09-10", TODAY) },
    { product: product({ id: "e", stock: 8 }), expiry: expiryStatus("2026-08-01", TODAY) },
  ];

  it("counts each bucket", () => {
    expect(countByFilter(rows)).toEqual({
      all: 5, in_stock: 4, low: 1, out: 1, expiring_soon: 1, expired: 1,
    });
  });

  /**
   * A product with none left is a different problem from one running low, and
   * listing it under both makes the counts overlap and stop adding up.
   */
  it("does not count an out-of-stock product as low", () => {
    expect(matchesFilter(rows[2], "low")).toBe(false);
    expect(matchesFilter(rows[2], "out")).toBe(true);
  });
});

describe("search", () => {
  const row = { product: product({ tags: ["chilled", "promo"] }), expiry: null };

  it("matches name, sku, barcode and tags", () => {
    expect(matchesQuery(row, "meat")).toBe(true);
    expect(matchesQuery(row, "MP-1")).toBe(true);
    expect(matchesQuery(row, "5012345")).toBe(true);
    expect(matchesQuery(row, "chilled")).toBe(true);
    expect(matchesQuery(row, "bread")).toBe(false);
  });

  it("matches everything on an empty query", () => {
    expect(matchesQuery(row, "   ")).toBe(true);
  });
});

describe("csv export", () => {
  /**
   * Product names contain commas often enough that unquoted output produces a
   * file which opens with the columns silently shifted — worse than one that
   * fails to open, because someone will act on it.
   */
  it("quotes fields containing commas and doubles inner quotes", () => {
    const csv = inventoryToCsv(
      [{ product: product({ name: 'Rice, 5kg "Gold"' }), expiry: null }],
      "GHS",
    );

    expect(csv).toContain('"Rice, 5kg ""Gold"""');
  });

  it("labels each row's stock status and expiry", () => {
    const csv = inventoryToCsv(
      [
        { product: product({ name: "Low one", stock: 2, reorder_level: 5 }), expiry: null },
        { product: product({ name: "Gone", stock: 0 }), expiry: expiryStatus("2026-08-01", TODAY) },
      ],
      "GHS",
    );

    expect(csv).toContain("Low one");
    expect(csv).toContain("Low");
    expect(csv).toContain("Out of stock");
    expect(csv).toContain("Expired 31 days ago");
  });

  /** Excel on Windows renders a currency symbol as mojibake without the BOM. */
  it("starts with a byte order mark and uses CRLF", () => {
    const csv = inventoryToCsv([{ product: product(), expiry: null }], "GHS");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
  });
});

describe("a default batch number", () => {
  /**
   * The server requires a batch number and enforces uniqueness per product, but
   * shops that track only expiry never see a lot number on the box. Deriving it
   * from the expiry date makes that uniqueness rule do something useful: two
   * deliveries expiring the same day are the same batch in practice.
   */
  it("is derived from the expiry date", () => {
    expect(suggestBatchNumber("2027-03-20")).toBe("EXP-20270320");
  });

  it("falls back to today when there is no expiry date", () => {
    expect(suggestBatchNumber(null)).toMatch(/^IN-\d{8}$/);
  });
});
