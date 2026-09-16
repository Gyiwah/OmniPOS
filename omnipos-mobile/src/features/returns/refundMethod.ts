import type { RefundMethod } from "./types";

/**
 * The refund methods a till may pick, in the order they are offered.
 *
 * The same four the web till has (omnipos-web ReturnsPage), so a shop running
 * both sees one vocabulary. Labels and icons belong to the screen; what is
 * shared is the list itself and the rule for choosing from it.
 */
export const REFUND_METHODS: readonly RefundMethod[] = ["cash", "card", "transfer", "momo"];

/**
 * Every spelling a sale's payment method arrives in, mapped to the one this app
 * uses. The Laravel eligibility lookup returns the server's canonical
 * 'mobile_money'; a locally rung sale on this device says 'momo'. They are the
 * same tender and must default to the same refund.
 */
const SPELLINGS: Record<string, RefundMethod> = {
  cash: "cash",
  card: "card",
  transfer: "transfer",
  bank_transfer: "transfer",
  "bank transfer": "transfer",
  momo: "momo",
  mobile_money: "momo",
  "mobile money": "momo",
  mobilemoney: "momo",
  "mtn momo": "momo",
};

/**
 * The refund method matching how a sale was paid, or null when the picker
 * cannot express it - a split tender, store credit, or a sale that recorded no
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
