/**
 * The refund methods a till may pick, in the order they are offered.
 *
 * Spelled the way this client's checkout stores them (`mobile_money`, not
 * `momo`) so a sale rung up here and a refund of that sale use the same word.
 * The server canonicalises either spelling. The mobile picker uses `momo`;
 * matchRefundMethod treats them as one tender so the default does not depend
 * on which device booked the sale.
 */
export const REFUND_METHODS = ["cash", "card", "transfer", "mobile_money"] as const;

export type RefundMethod = (typeof REFUND_METHODS)[number];

export const REFUND_METHOD_LABELS: Record<RefundMethod, string> = {
  cash: "Cash",
  card: "Card",
  transfer: "Transfer",
  mobile_money: "Mobile money",
};

export function refundMethodLabel(method: string): string {
  const matched = matchRefundMethod(method);
  if (matched) return REFUND_METHOD_LABELS[matched];
  return method.replace(/_/g, " ");
}

/**
 * Every spelling a sale's payment method arrives in, mapped to the one this
 * till uses. A locally rung sale says `mobile_money`; the same sale from the
 * phone or a Laravel eligibility lookup may say `momo`. They are the same
 * tender and must default to the same refund.
 */
const SPELLINGS: Record<string, RefundMethod> = {
  cash: "cash",
  card: "card",
  transfer: "transfer",
  bank_transfer: "transfer",
  "bank transfer": "transfer",
  momo: "mobile_money",
  mobile_money: "mobile_money",
  "mobile money": "mobile_money",
  mobilemoney: "mobile_money",
  "mtn momo": "mobile_money",
};

/**
 * The refund method matching how a sale was paid, or null when the picker
 * cannot express it — a split tender, store credit, or a sale that recorded no
 * method at all.
 *
 * Null rather than a fallback so the screen can tell the two apart: "this was a
 * cash sale" and "nobody knows what this was" both default to cash, but only
 * one of them is worth telling a cashier they match.
 */
export function matchRefundMethod(paymentMethod?: string | null): RefundMethod | null {
  const key = String(paymentMethod ?? "").trim().toLowerCase();

  return SPELLINGS[key] ?? null;
}

/**
 * What to refund a sale paid this way on.
 *
 * Money goes back the way it came in. That is what happens at a counter, and it
 * is the only default that leaves the drawer honest: the backend books a refund
 * as a negative payment on this method, so a mobile money refund recorded as
 * cash takes money out of the expected cash that never left the till. The
 * drawer then counts over by the refund, every time.
 *
 * What the picker cannot express falls back to cash, which is the common case
 * and which the cashier can see and change before confirming.
 */
export function defaultRefundMethod(paymentMethod?: string | null): RefundMethod {
  return matchRefundMethod(paymentMethod) ?? "cash";
}
