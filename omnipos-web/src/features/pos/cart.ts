/**
 * Cart arithmetic.
 *
 * All money is handled as integer minor units (pesewas, cents) and only
 * converted to a decimal string at the edges. JavaScript numbers cannot
 * represent 0.1 exactly, so accumulating floats across a basket produces totals
 * that are a penny out — which on a till is the difference between a drawer that
 * balances and one that does not.
 */

export type CartLine = {
  id: string;
  productId: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  /** Minor units. */
  unitPrice: number;
  unitCost: number | null;
  quantity: number;
  /** Stock on hand when the line was added, for the oversell check. */
  availableStock: number | null;
};

export type DiscountMode = "percentage" | "amount";

export type CartTotals = {
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
};

export type TaxRates = {
  taxRate: number;
  vatRate: number;
  serviceRate: number;
};

/** "12.50" -> 1250. Tolerates numbers, blanks and stray currency symbols. */
export function toMinor(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Math.round(value * 100);

  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return 0;

  return Math.round(Number.parseFloat(cleaned) * 100);
}

/** 1250 -> "12.50". */
export function toDecimal(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function formatMoney(minor: number, currency = "GHS"): string {
  return `${currency} ${toDecimal(minor)}`;
}

export function lineTotal(line: CartLine): number {
  return line.unitPrice * line.quantity;
}

/**
 * Percentage discounts round half-up on the whole basket rather than per line,
 * so the total always matches what the customer was shown.
 */
export function computeTotals(
  lines: CartLine[],
  discountMode: DiscountMode,
  discountValue: number,
  rates: TaxRates,
): CartTotals {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);

  let discount =
    discountMode === "percentage"
      ? Math.round((subtotal * clampPercent(discountValue)) / 100)
      : Math.min(discountValue, subtotal);

  if (discount < 0) discount = 0;

  const taxable = subtotal - discount;
  const combinedRate = clampPercent(rates.taxRate) + clampPercent(rates.vatRate) + clampPercent(rates.serviceRate);
  const tax = Math.round((taxable * combinedRate) / 100);

  return { subtotal, discount, taxable, tax, total: taxable + tax };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, 100);
}

export function addLine(lines: CartLine[], incoming: Omit<CartLine, "quantity">, quantity = 1): CartLine[] {
  if (incoming.availableStock !== null && incoming.availableStock < quantity) return lines;

  // Scanning the same barcode twice increments rather than creating a second
  // line, which is what a cashier expects and keeps the receipt readable.
  const index = lines.findIndex((l) => l.productId !== null && l.productId === incoming.productId);

  if (index >= 0) {
    if (
      incoming.availableStock !== null
      && lines[index].quantity + quantity > incoming.availableStock
    ) return lines;

    const next = [...lines];
    next[index] = { ...next[index], quantity: next[index].quantity + quantity };
    return next;
  }

  return [...lines, { ...incoming, quantity }];
}

export function setQuantity(lines: CartLine[], lineId: string, quantity: number): CartLine[] {
  if (quantity <= 0) return lines.filter((l) => l.id !== lineId);
  return lines.map((l) => {
    if (l.id !== lineId) return l;
    const capped = l.availableStock === null ? quantity : Math.min(quantity, l.availableStock);
    return { ...l, quantity: capped };
  });
}

export function removeLine(lines: CartLine[], lineId: string): CartLine[] {
  return lines.filter((l) => l.id !== lineId);
}

/**
 * Lines being sold beyond the stock this till knows about.
 */
export function oversoldLines(lines: CartLine[]): CartLine[] {
  return lines.filter((l) => l.availableStock !== null && l.quantity > l.availableStock);
}

export type TenderLine = { method: string; amount: number };

export function tenderedTotal(tenders: TenderLine[]): number {
  return tenders.reduce((sum, t) => sum + t.amount, 0);
}

/** Positive when the customer still owes, negative when change is due. */
export function balanceDue(total: number, tenders: TenderLine[]): number {
  return total - tenderedTotal(tenders);
}

export function changeDue(total: number, tenders: TenderLine[]): number {
  const balance = balanceDue(total, tenders);
  return balance < 0 ? -balance : 0;
}

export function amountPaid(total: number, tenders: TenderLine[]): number {
  // Change handed back is not revenue: a GHS 50 note against a GHS 30 basket is
  // 30 paid, not 50. Recording the note would overstate both the day's takings
  // and the drawer.
  return Math.min(tenderedTotal(tenders), total);
}

/**
 * Whether the sale may complete.
 *
 * A walk-in must pay in full — there is no account to carry the remainder. A
 * named customer may leave a balance, which becomes their debt.
 */
export function canComplete(
  total: number,
  tenders: TenderLine[],
  hasCustomer: boolean,
  lines: CartLine[] = [],
): { ok: true } | { ok: false; reason: string } {
  if (total <= 0) return { ok: false, reason: "The cart is empty." };

  const oversold = oversoldLines(lines);
  if (oversold.length > 0) {
    return {
      ok: false,
      reason: `Not enough stock for: ${oversold.map((line) => line.name).join(", ")}. Reduce the quantity before completing the sale.`,
    };
  }

  const balance = balanceDue(total, tenders);

  if (balance > 0 && !hasCustomer) {
    return {
      ok: false,
      reason: `Short by ${toDecimal(balance)}. Take full payment, or attach a customer to record the balance as credit.`,
    };
  }

  return { ok: true };
}
