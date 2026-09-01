import type { LocalProduct } from "@/db/schema";
import { toMinor } from "@/features/pos/cart";
import { suggestSku } from "./service";

/**
 * Bringing a shop's spreadsheet in.
 *
 * This is usually the first thing a new shop does, with a file exported from
 * whatever they used before, so it has to survive real-world CSV rather than the
 * tidy kind. The parser below is RFC 4180 — quoted fields, doubled quotes,
 * newlines inside a cell — because splitting on commas silently shifts every
 * column after the first product called "Rice, 5kg", and a shifted column means
 * a price landing in a stock field.
 *
 * That is not hypothetical: it is exactly the file this app's own export
 * produces.
 */

/** Split a CSV into rows of cells. Handles quotes, escaped quotes and CRLF. */
export function parseCsv(text: string): string[][] {
  // A byte order mark on the first cell would make a header match fail for
  // reasons nobody could see by looking at the file.
  const input = text.replace(/^﻿/, "");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      // Swallow the LF of a CRLF pair rather than emitting a blank row.
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Which column is which.
 *
 * The same vocabulary the mobile importer uses, so a file that works on a phone
 * works here. A column is claimed by the first field that wants it, which is why
 * this is an ordered list rather than an object — three pairs would otherwise
 * steal from each other, and every one of them appears in real files:
 *
 *   "Barcode" contains "code", so it would be taken as the SKU;
 *   "Cost price" contains "price", so it would be taken as the sell price;
 *   "Low stock" contains "stock", so it would be taken as the quantity.
 *
 * Each of those puts a number in the wrong field with nothing looking wrong —
 * importing a whole catalogue at its wholesale price, say, which a shop finds
 * out about one sale at a time.
 */
const COLUMNS = [
  ["barcode", ["barcode", "upc", "ean", "scan"]],
  ["cost", ["cost", "buy", "purchase", "wholesale"]],
  ["reorder", ["reorder", "minimum", "min", "threshold", "low"]],
  ["price", ["sell", "price", "retail", "unit"]],
  ["stock", ["stock", "qty", "quantity", "count", "hand"]],
  ["sku", ["sku", "code", "item", "reference"]],
  ["name", ["name", "product", "title", "description"]],
  ["tags", ["tag", "category", "group"]],
] as const;

type Field = (typeof COLUMNS)[number][0];

export type ColumnMap = Partial<Record<Field, number>>;

export function mapColumns(header: string[]): ColumnMap {
  const cleaned = header.map((h) => h.trim().toLowerCase().replace(/["']/g, ""));
  const map: ColumnMap = {};
  const taken = new Set<number>();

  for (const [field, needles] of COLUMNS) {
    const index = cleaned.findIndex((h, i) => !taken.has(i) && needles.some((n) => h.includes(n)));
    if (index !== -1) {
      map[field] = index;
      taken.add(index);
    }
  }

  return map;
}

export type ImportRow = {
  line: number;
  name: string;
  sku: string;
  barcode: string | null;
  /** Minor units. */
  price: number;
  cost: number | null;
  stock: number;
  reorderLevel: number;
  tags: string[];
  /** Whether a product with this SKU already exists in the catalogue. */
  action: "create" | "update" | "skip";
  problem: string | null;
};

function number(raw: string | undefined): number | null {
  if (!raw) return null;
  // Currency symbols, thousands separators and stray spaces are all normal in a
  // spreadsheet export.
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Turn parsed rows into something reviewable.
 *
 * Every row comes back, including the broken ones, with what is wrong stated on
 * it. An importer that quietly drops the rows it did not like leaves a shop
 * believing it has a full catalogue.
 */
export function planImport(rows: string[][], existing: LocalProduct[]): ImportRow[] {
  if (rows.length < 2) return [];

  const map = mapColumns(rows[0]);
  const bySku = new Map(existing.map((p) => [p.sku.trim().toLowerCase(), p]));
  const seen = new Map<string, number>();

  /*
   * Fall back to the first two columns only when the header matched nothing at
   * all — a file with no header worth the name. Doing it per field instead
   * meant a `Name,Price` file took its price column as the SKU, because the
   * SKU had no match and column 1 was simply assumed to be one.
   */
  const headerless = Object.keys(map).length === 0;

  return rows.slice(1).map((cells, index) => {
    const line = index + 2;
    const at = (field: Field) => {
      const i = map[field];
      return i === undefined ? undefined : cells[i]?.trim();
    };

    const name = (at("name") ?? (headerless ? cells[0] : "") ?? "").trim();
    const rawSku = (at("sku") ?? (headerless ? cells[1] : "") ?? "").trim();
    const price = number(at("price"));

    const sku = rawSku || suggestSku(name);
    const key = sku.toLowerCase();
    const match = bySku.get(key);

    let problem: string | null = null;
    if (!name) problem = "No product name";
    else if (price === null) problem = "No price";
    else if (price < 0) problem = "Negative price";
    else if (seen.has(key)) problem = `SKU ${sku} is also on line ${seen.get(key)}`;

    seen.set(key, line);

    return {
      line,
      name,
      sku,
      barcode: at("barcode") || null,
      price: price === null ? 0 : toMinor(String(price)),
      cost: number(at("cost")) === null ? null : toMinor(String(number(at("cost")))),
      stock: Math.max(0, Math.round(number(at("stock")) ?? 0)),
      reorderLevel: Math.max(0, Math.round(number(at("reorder")) ?? 0)),
      tags: (at("tags") ?? "")
        .split(/[;|]/)
        .map((t) => t.trim())
        .filter(Boolean),
      action: problem ? "skip" : match ? "update" : "create",
      problem,
    };
  });
}

export type ImportSummary = {
  create: number;
  update: number;
  skip: number;
  /** Rows whose stock column will become an opening movement. */
  opening: number;
};

export function summarise(rows: ImportRow[]): ImportSummary {
  return rows.reduce<ImportSummary>(
    (acc, row) => {
      acc[row.action] += 1;
      // Only a new product's count becomes a movement. See importProducts.
      if (row.action === "create" && row.stock > 0) acc.opening += 1;
      return acc;
    },
    { create: 0, update: 0, skip: 0, opening: 0 },
  );
}
