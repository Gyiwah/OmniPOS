export type CartMathInput = {
  lines: Array<{ price: number; quantity: number }>;
  discountMode: "percentage" | "amount";
  discountValue: number;
  taxRate?: number;
  vatRate?: number;
  serviceRate?: number;
  amountPaid?: number;
};

export type CartMathResult = {
  subtotal: number;
  discountAmount: number;
  taxedBase: number;
  tax: number;
  vat: number;
  service: number;
  total: number;
  change: number;
  balance: number;
};

export function calculateCartTotals(input: CartMathInput): CartMathResult {
  const {
    lines,
    discountMode,
    discountValue,
    taxRate = 0,
    vatRate = 0,
    serviceRate = 0,
    amountPaid = 0,
  } = input;

  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const discountAmount =
    discountMode === "percentage"
      ? subtotal * (discountValue / 100)
      : Math.min(subtotal, discountValue);

  const taxedBase = Math.max(0, subtotal - discountAmount);
  const tax = taxedBase * (taxRate / 100);
  const vat = taxedBase * (vatRate / 100);
  const service = taxedBase * (serviceRate / 100);

  const total = taxedBase + tax + vat + service;
  const change = Math.max(0, amountPaid - total);
  const balance = Math.max(0, total - amountPaid);

  return {
    subtotal,
    discountAmount,
    taxedBase,
    tax,
    vat,
    service,
    total,
    change,
    balance,
  };
}

/** Notes a cashier is likely to be handed, rounded up from the amount due. */
const TENDER_STEPS = [10, 20, 50, 100] as const;

/**
 * Quick-tender amounts to offer beside the exact total.
 *
 * Each step is rounded up to its next multiple, which is what a cashier is
 * actually handed: a 20 for an 11.22 sale. Different steps frequently round to
 * the same note — 11.22 rounds to 20 under both the 10 and the 20 step, and 45
 * rounds to 50 under both the 10 and the 50 — so the results are deduplicated.
 * Without that the row showed "₵20 ₵20", two identical buttons side by side,
 * which reads as a rendering fault and makes a cashier hesitate mid-sale.
 *
 * Anything at or below the total is dropped: it is not a tender, and the exact
 * amount already has its own chip.
 */
export function tenderSuggestions(total: number): number[] {
  if (!Number.isFinite(total) || total <= 0) return [];

  const amounts = new Set<number>();
  for (const step of TENDER_STEPS) {
    const rounded = Math.ceil(total / step) * step;
    if (rounded > total) amounts.add(rounded);
  }

  return [...amounts].sort((a, b) => a - b);
}
