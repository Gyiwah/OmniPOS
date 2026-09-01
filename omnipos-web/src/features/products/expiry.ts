import type { LocalBatch, LocalProduct } from "@/db/schema";

/**
 * Expiry and stock status for the inventory list.
 *
 * Deliberately the same rules and the same 30-day threshold the mobile app uses,
 * so a manager who checks stock on a phone and then on a browser is not told two
 * different things about the same shelf.
 *
 * Pure and date-injectable: "expired" is a claim about today, and a function
 * that reads the clock itself cannot be tested for the boundary cases that
 * matter — the day something expires, and the day after.
 */

export type ExpiryStatus = "expired" | "expiring_soon" | "good" | "no_expiry";

export type ExpiryInfo = {
  status: ExpiryStatus;
  daysRemaining: number | null;
  label: string;
};

export const EXPIRY_THRESHOLD_DAYS = 30;

export function expiryStatus(
  expiryDate: string | null | undefined,
  today: Date = new Date(),
  thresholdDays: number = EXPIRY_THRESHOLD_DAYS,
): ExpiryInfo {
  if (!expiryDate || !expiryDate.trim()) {
    return { status: "no_expiry", daysRemaining: null, label: "No expiry" };
  }

  const parsed = new Date(expiryDate);
  if (Number.isNaN(parsed.getTime())) {
    return { status: "no_expiry", daysRemaining: null, label: "No expiry" };
  }

  // Both floored to midnight: a batch that expires today is not "expired" at
  // nine in the morning, and comparing timestamps would say it was.
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);

  const days = Math.ceil((parsed.getTime() - start.getTime()) / 86_400_000);

  if (days < 0) {
    const ago = Math.abs(days);
    return { status: "expired", daysRemaining: days, label: ago === 1 ? "Expired 1 day ago" : `Expired ${ago} days ago` };
  }

  if (days <= thresholdDays) {
    return {
      status: "expiring_soon",
      daysRemaining: days,
      label: days === 0 ? "Expires today" : days === 1 ? "Expires tomorrow" : `Expires in ${days} days`,
    };
  }

  return { status: "good", daysRemaining: days, label: `Expires in ${days} days` };
}

/**
 * The worst news about a product, across all its batches.
 *
 * Worst rather than earliest, and empty batches are skipped: a lot that expired
 * last month but has nothing left in it is not a problem on the shelf, and
 * flagging it would train people to ignore the flag.
 */
export function worstBatchExpiry(batches: LocalBatch[], today: Date = new Date()): ExpiryInfo | null {
  const live = batches.filter((b) => Number(b.quantity) > 0 && b.expiry_date);
  if (live.length === 0) return null;

  const rank: Record<ExpiryStatus, number> = { expired: 3, expiring_soon: 2, good: 1, no_expiry: 0 };

  return live
    .map((b) => expiryStatus(b.expiry_date, today))
    .reduce((worst, info) => {
      if (rank[info.status] > rank[worst.status]) return info;
      // Same status: the one with less time left is the one to act on.
      if (rank[info.status] === rank[worst.status] && (info.daysRemaining ?? 0) < (worst.daysRemaining ?? 0)) {
        return info;
      }
      return worst;
    });
}

export type StockFilter = "all" | "in_stock" | "low" | "expiring_soon" | "expired" | "out";

export type InventoryRow = {
  product: LocalProduct;
  expiry: ExpiryInfo | null;
};

export function matchesFilter(row: InventoryRow, filter: StockFilter): boolean {
  const stock = row.product.stock;

  switch (filter) {
    case "in_stock":
      return stock > 0;
    case "out":
      return stock <= 0;
    // "Low" excludes anything already out: a product with none left is a
    // different problem, and listing it under both makes the counts overlap.
    case "low":
      return stock > 0 && stock <= row.product.reorder_level;
    case "expiring_soon":
      return row.expiry?.status === "expiring_soon";
    case "expired":
      return row.expiry?.status === "expired";
    default:
      return true;
  }
}

export type FilterCounts = Record<StockFilter, number>;

export function countByFilter(rows: InventoryRow[]): FilterCounts {
  const counts: FilterCounts = { all: rows.length, in_stock: 0, low: 0, expiring_soon: 0, expired: 0, out: 0 };

  for (const row of rows) {
    for (const filter of ["in_stock", "low", "expiring_soon", "expired", "out"] as const) {
      if (matchesFilter(row, filter)) counts[filter] += 1;
    }
  }

  return counts;
}

/** Free-text search over the fields a person would actually type at a counter. */
export function matchesQuery(row: InventoryRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const p = row.product;
  return (
    p.search_key.includes(needle) ||
    p.barcode === needle ||
    p.sku.toLowerCase().includes(needle) ||
    p.tags.some((t) => t.toLowerCase().includes(needle))
  );
}
