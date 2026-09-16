import { describe, expect, it } from "vitest";

import {
  defaultRefundMethod,
  matchRefundMethod,
  REFUND_METHODS,
  refundMethodLabel,
} from "./refundMethod";

/**
 * Which method a refund goes back on decides whether the drawer reconciles.
 *
 * The backend books a refund as a negative payment row on this method, and only
 * cash rows count towards the expected cash. So a mobile money refund labelled
 * cash removes money from the expected drawer that never left it, and the shift
 * counts over by the refund amount — every time, on every non-cash refund.
 */
describe("refund method", () => {
  it("offers the same four methods as checkout on this till", () => {
    expect([...REFUND_METHODS]).toEqual(["cash", "card", "transfer", "mobile_money"]);
  });

  /**
   * The default is the method the sale was paid with, because that is what
   * happens at a counter: the customer is handed back the money the way they
   * gave it. Defaulting to cash instead was the bug.
   */
  it.each([
    ["cash", "cash"],
    ["card", "card"],
    ["transfer", "transfer"],
    ["mobile_money", "mobile_money"],
  ])("refunds a sale paid by %s the same way", (paid, expected) => {
    expect(defaultRefundMethod(paid)).toBe(expected);
  });

  /**
   * Both spellings of the one tender. A sale rung up on this device says
   * `mobile_money`; the same sale read back from a phone says `momo`. If only
   * one of them mapped, whether the drawer reconciled would depend on which
   * till booked the sale.
   */
  it.each(["momo", "mobile_money", "Mobile Money", " MOMO ", "mtn momo"])(
    "treats %s as mobile money",
    (paid) => {
      expect(defaultRefundMethod(paid)).toBe("mobile_money");
    },
  );

  it.each(["bank_transfer", "Bank Transfer", "TRANSFER"])("treats %s as a transfer", (paid) => {
    expect(defaultRefundMethod(paid)).toBe("transfer");
  });

  /**
   * A method the picker cannot offer — a split tender, store credit, or an
   * imported sale that never recorded one — falls back to cash. It is the
   * common case, it is visible in the picker, and the cashier can change it
   * before confirming.
   */
  it.each([undefined, null, "", "   ", "split", "store_credit", "loyalty", "cheque"])(
    "falls back to cash for %s",
    (paid) => {
      expect(defaultRefundMethod(paid)).toBe("cash");
    },
  );

  /**
   * A cash sale and a sale nobody recorded a method for both default to cash.
   * Only the first may be described to a cashier as matching, so the two have
   * to stay distinguishable.
   */
  it("separates a genuine cash sale from one with no usable method", () => {
    expect(matchRefundMethod("cash")).toBe("cash");
    expect(matchRefundMethod("split")).toBeNull();
    expect(matchRefundMethod(null)).toBeNull();
    expect(defaultRefundMethod("split")).toBe("cash");
  });

  it("only ever returns a method the picker offers", () => {
    for (const input of ["cash", "momo", "split", "", "nonsense"]) {
      expect(REFUND_METHODS).toContain(defaultRefundMethod(input));
    }
  });

  it("labels both spellings of mobile money the way checkout does", () => {
    expect(refundMethodLabel("mobile_money")).toBe("Mobile money");
    expect(refundMethodLabel("momo")).toBe("Mobile money");
  });
});
