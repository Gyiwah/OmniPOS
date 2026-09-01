import type { LocalCashMovement, LocalOrder, LocalPayment, LocalReturn } from "@/db/schema";
import { toMinor } from "@/features/pos/cart";

/**
 * Drawer arithmetic.
 *
 * Kept separate from the UI and the database because this is the calculation a
 * shop actually argues about at the end of a day. It is worth being able to test
 * it directly, in minor units, without a browser.
 *
 * The server recomputes all of this from the payments ledger when the shift
 * syncs, and its figure wins. This exists so a cashier closing a drawer with no
 * connection is not told to come back later.
 */

export type DrawerCounts = {
  /** Cash handed to the shop for goods. Card and transfer are excluded. */
  cashSales: number;
  /**
   * Cash taken against an existing debt, which is money in the box exactly as
   * a sale is. Counted separately because it is not today's trade — a drawer
   * that folded it into sales would report a day's takings that never happened.
   */
  cashSettlements: number;
  /** Cash handed back for returns. */
  cashRefunds: number;
  paidIn: number;
  paidOut: number;
  openingFloat: number;
  expected: number;
};

/**
 * Only cash reaches the drawer.
 *
 * A GHS 200 card sale puts nothing in the till, so counting it would leave every
 * honest drawer looking short by the day's card takings. Split tenders are the
 * ordinary case, so this sums the cash legs rather than looking at the order's
 * headline payment_method.
 */
export function cashTakenIn(order: LocalOrder): number {
  return order.payments
    .filter((p) => p.method === "cash")
    .reduce((sum, p) => sum + toMinor(p.amount), 0);
}

export function cashPaidOut(refund: LocalReturn): number {
  return refund.refund_method === "cash" ? toMinor(refund.amount) : 0;
}

export function cashSettled(payment: LocalPayment): number {
  return payment.method === "cash" ? toMinor(payment.amount) : 0;
}

export function movementTotals(movements: LocalCashMovement[]): { paidIn: number; paidOut: number } {
  return movements.reduce(
    (acc, m) => {
      const amount = toMinor(m.amount);
      if (m.direction === "in") acc.paidIn += amount;
      else acc.paidOut += amount;
      return acc;
    },
    { paidIn: 0, paidOut: 0 },
  );
}

/**
 * What the drawer should hold.
 *
 * Refunds are subtracted here because the client counts sales and refunds
 * separately. The server does NOT subtract them again — there they are negative
 * rows in the same payments ledger, so summing that ledger has already netted
 * them out. Both arrive at the same number by different routes; subtracting
 * twice on either side would make an honest till look short by exactly the day's
 * refunds.
 */
export function expectedCash(input: {
  openingFloat: number;
  cashSales: number;
  cashSettlements: number;
  cashRefunds: number;
  paidIn: number;
  paidOut: number;
}): number {
  return (
    input.openingFloat +
    input.cashSales +
    input.cashSettlements -
    input.cashRefunds +
    input.paidIn -
    input.paidOut
  );
}

/** Positive when the drawer is over, negative when it is short. */
export function discrepancy(counted: number, expected: number): number {
  return counted - expected;
}

export function summariseDrawer(
  shift: { opening_float: string; movements: LocalCashMovement[] },
  orders: LocalOrder[],
  refunds: LocalReturn[],
  settlements: LocalPayment[] = [],
): DrawerCounts {
  const cashSales = orders.reduce((sum, o) => sum + cashTakenIn(o), 0);
  const cashSettlements = settlements.reduce((sum, p) => sum + cashSettled(p), 0);
  const cashRefunds = refunds.reduce((sum, r) => sum + cashPaidOut(r), 0);
  const { paidIn, paidOut } = movementTotals(shift.movements);
  const openingFloat = toMinor(shift.opening_float);

  return {
    cashSales,
    cashSettlements,
    cashRefunds,
    paidIn,
    paidOut,
    openingFloat,
    expected: expectedCash({ openingFloat, cashSales, cashSettlements, cashRefunds, paidIn, paidOut }),
  };
}

/**
 * A Z-report is the end-of-shift summary a manager signs off.
 *
 * Takings are reported per tender method, because "GHS 4,000 today" is not
 * actionable — what matters is how much of it should be in the drawer and how
 * much went to the card machine.
 */
export type ZReport = {
  orderCount: number;
  settlementCount: number;
  settlementTotal: number;
  grossSales: number;
  refundTotal: number;
  refundCount: number;
  netSales: number;
  byMethod: Array<{ method: string; amount: number }>;
  drawer: DrawerCounts;
  counted: number | null;
  variance: number | null;
};

export function buildZReport(
  shift: { opening_float: string; movements: LocalCashMovement[]; actual_cash: string | null },
  orders: LocalOrder[],
  refunds: LocalReturn[],
  settlements: LocalPayment[] = [],
): ZReport {
  const drawer = summariseDrawer(shift, orders, refunds, settlements);

  const byMethod = new Map<string, number>();
  for (const order of orders) {
    for (const payment of order.payments) {
      byMethod.set(payment.method, (byMethod.get(payment.method) ?? 0) + toMinor(payment.amount));
    }
  }
  // Settlements add to the method they came in on: money through the card
  // machine is money the card machine has to account for, whether it paid for
  // goods today or last week.
  for (const settlement of settlements) {
    byMethod.set(settlement.method, (byMethod.get(settlement.method) ?? 0) + toMinor(settlement.amount));
  }
  // Refunds reduce the method they were paid back on, so the report shows what
  // each channel actually netted rather than what it grossed.
  for (const refund of refunds) {
    const method = refund.refund_method;
    byMethod.set(method, (byMethod.get(method) ?? 0) - toMinor(refund.amount));
  }

  const grossSales = orders.reduce((sum, o) => sum + toMinor(o.total), 0);
  const refundTotal = refunds.reduce((sum, r) => sum + toMinor(r.amount), 0);
  const counted = shift.actual_cash === null ? null : toMinor(shift.actual_cash);

  return {
    orderCount: orders.length,
    // Reported apart from sales throughout: a debt settled today is cash in the
    // drawer but it is not trade done today, and adding it to the day's takings
    // would overstate the business.
    settlementCount: settlements.length,
    settlementTotal: settlements.reduce((sum, p) => sum + toMinor(p.amount), 0),
    grossSales,
    refundTotal,
    refundCount: refunds.length,
    netSales: grossSales - refundTotal,
    byMethod: [...byMethod.entries()]
      .map(([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount),
    drawer,
    counted,
    variance: counted === null ? null : discrepancy(counted, drawer.expected),
  };
}
