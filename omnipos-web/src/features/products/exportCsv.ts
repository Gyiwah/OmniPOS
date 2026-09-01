import type { InventoryRow } from "./expiry";

/**
 * Inventory as a CSV, for a stocktake sheet or an accountant.
 *
 * Built and downloaded entirely in the browser: the data is already here, and
 * asking the server to render a file the client can produce would put an export
 * behind a connection for no reason.
 */

/**
 * RFC 4180 quoting.
 *
 * A field is wrapped when it holds a comma, a quote or a newline, and inner
 * quotes are doubled. Product names contain commas often enough that skipping
 * this produces a file that opens with the columns silently shifted — which is
 * worse than a file that fails to open, because someone will act on it.
 */
function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function inventoryToCsv(rows: InventoryRow[], currency: string): string {
  const header = [
    "Name", "SKU", "Barcode", `Price (${currency})`, `Cost (${currency})`,
    "Stock", "Reorder at", "Status", "Expiry", "Tags", "Active",
  ];

  const body = rows.map(({ product: p, expiry }) => [
    p.name,
    p.sku,
    p.barcode ?? "",
    p.price,
    p.cost_price ?? "",
    p.stock,
    p.reorder_level,
    p.stock <= 0 ? "Out of stock" : p.stock <= p.reorder_level ? "Low" : "In stock",
    expiry?.label ?? "",
    p.tags.join(" "),
    p.is_active ? "yes" : "no",
  ]);

  // CRLF and a BOM: Excel on Windows is the overwhelmingly likely destination,
  // and without the BOM it renders anything non-ASCII — a currency symbol, an
  // accented product name — as mojibake.
  return "﻿" + [header, ...body].map((r) => r.map(cell).join(",")).join("\r\n");
}

export function exportInventoryCsv(rows: InventoryRow[], storeName: string, currency: string): void {
  const csv = inventoryToCsv(rows, currency);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = storeName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "store";

  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName}-inventory-${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Released on the next tick rather than immediately: revoking synchronously
  // can cancel the download in some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
