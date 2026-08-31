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
