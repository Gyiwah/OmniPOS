import {
  defaultRefundMethod,
  matchRefundMethod,
  REFUND_METHODS,
} from "../features/returns/refundMethod";

/**
 * Which method a refund goes back on decides whether the drawer reconciles.
 *
 * The backend books a refund as a negative payment row on this method, and only
 * cash rows count towards the expected cash. So a mobile money refund labelled
 * cash removes money from the expected drawer that never left it, and the shift
 * counts over by the refund amount - every time, on every non-cash refund.
 */
describe("refund method", () => {
  it("offers the same four methods as the web till", () => {
    expect([...REFUND_METHODS]).toEqual(["cash", "card", "transfer", "momo"]);
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
    ["momo", "momo"],
  ])("refunds a sale paid by %s the same way", (paid, expected) => {
    expect(defaultRefundMethod(paid)).toBe(expected);
  });

  /**
   * Both spellings of the one tender. A sale rung up on this device says
   * 'momo'; the same sale read back from the server says 'mobile_money'. If
   * only one of them mapped, whether the drawer reconciled would depend on
   * whether the till had synced yet.
   */
  it.each(["momo", "mobile_money", "Mobile Money", " MOMO ", "mtn momo"])(
    "treats %s as mobile money",
    (paid) => {
      expect(defaultRefundMethod(paid)).toBe("momo");
    },
  );

  it.each(["bank_transfer", "Bank Transfer", "TRANSFER"])("treats %s as a transfer", (paid) => {
    expect(defaultRefundMethod(paid)).toBe("transfer");
  });

  /**
   * A method the picker cannot offer - a split tender, store credit, or an
   * imported sale that never recorded one - falls back to cash. It is the
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
    for (const input of ["cash", "mobile_money", "split", "", "nonsense"]) {
      expect(REFUND_METHODS).toContain(defaultRefundMethod(input));
    }
  });
});
