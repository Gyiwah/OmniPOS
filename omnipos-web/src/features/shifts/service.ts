import { uuidv7 } from "@/core/uuidv7";
import {
  db,
  type LocalCashMovement,
  type LocalOrder,
  type LocalPayment,
  type LocalReturn,
  type LocalShift,
} from "@/db/schema";
import { toDecimal } from "@/features/pos/cart";
import { enqueue } from "@/sync/engine";
import { movementTotals, summariseDrawer } from "./shift";

/**
 * Opening, running and closing the cash drawer.
 *
 * Every operation writes locally and queues for the server in one transaction —
 * the same shape as a sale, and for the same reason. A shop whose connection is
 * down still opens its drawer at eight in the morning.
 *
 * A shift's id is minted here and is the id the server uses, so re-pushing an
 * interrupted close cannot create a second shift.
 */

export async function openShift(input: {
  storeId: string;
  cashierUserId: string;
  cashierName: string;
  openingFloat: number;
  notes?: string | null;
}): Promise<LocalShift> {
  const existing = await currentShift(input.storeId, input.cashierUserId);
  if (existing) {
    // The server enforces one open shift per cashier per store with a partial
    // unique index. Catching it here means the cashier gets a sentence instead
    // of a sync conflict an hour later.
    throw new Error("This cashier already has an open drawer. Close it before opening another.");
  }

  const shift: LocalShift = {
    id: uuidv7(),
    store_id: input.storeId,
    cashier_user_id: input.cashierUserId,
    cashier_name: input.cashierName,
    opened_at: new Date().toISOString(),
    closed_at: null,
    opening_float: toDecimal(input.openingFloat),
    cash_in: "0.00",
    cash_out: "0.00",
    actual_cash: null,
    expected_cash: null,
    status: "open",
    notes: input.notes ?? null,
    movements: [],
    _state: "pending",
  };

  await db.transaction("rw", [db.shifts, db.outbox], async () => {
    await db.shifts.put(shift);
    await enqueue({
      storeId: input.storeId,
      entity: "register_shifts",
      action: "upsert",
      recordId: shift.id,
      payload: toPayload(shift),
    });
  });

  return shift;
}

/**
 * Money in or out of the drawer that is not a sale: a float top-up, paying a
 * supplier in cash, taking the takings to the bank mid-shift.
 *
 * Each movement is queued as a fresh operation carrying the whole shift, rather
 * than a delta. The server's handler is an upsert on the shift row, so the last
 * state to arrive is the right one — and a movement lost in a dropped
 * connection is re-sent with the next one rather than vanishing.
 */
export async function recordCashMovement(input: {
  storeId: string;
  shiftId: string;
  direction: "in" | "out";
  amount: number;
  reason: string;
}): Promise<LocalShift> {
  if (input.amount <= 0) {
    throw new Error("A cash movement needs an amount.");
  }
  if (!input.reason.trim()) {
    // Unexplained cash leaving a drawer is how shrinkage hides. The server does
    // not enforce this, so the till does.
    throw new Error("Say what the cash was for.");
  }

  const movement: LocalCashMovement = {
    id: uuidv7(),
    direction: input.direction,
    amount: toDecimal(input.amount),
    reason: input.reason.trim(),
    at: new Date().toISOString(),
  };

  return db.transaction("rw", [db.shifts, db.outbox], async () => {
    const shift = await db.shifts.get(input.shiftId);
    if (!shift) throw new Error("That drawer session is no longer on this till.");
    if (shift.status === "closed") throw new Error("This drawer is closed.");

    const movements = [...shift.movements, movement];
    const { paidIn, paidOut } = movementTotals(movements);

    const updated: LocalShift = {
      ...shift,
      movements,
      cash_in: toDecimal(paidIn),
      cash_out: toDecimal(paidOut),
      _state: "pending",
    };

    await db.shifts.put(updated);
    await enqueue({
      storeId: input.storeId,
      entity: "register_shifts",
      action: "upsert",
      recordId: updated.id,
      payload: toPayload(updated),
    });

    return updated;
  });
}

/**
 * Close the drawer against a counted amount.
 *
 * The variance is recorded, never corrected. A till that quietly adjusts its own
 * expected figure to match what was counted cannot detect theft or error, which
 * is the only reason to count a drawer at all.
 */
export async function closeShift(input: {
  storeId: string;
  shiftId: string;
  countedCash: number;
  notes?: string | null;
}): Promise<LocalShift> {
  return db.transaction("rw", [db.shifts, db.orders, db.returns, db.payments, db.outbox], async () => {
    const shift = await db.shifts.get(input.shiftId);
    if (!shift) throw new Error("That drawer session is no longer on this till.");
    if (shift.status === "closed") throw new Error("This drawer is already closed.");

    const { orders, refunds, settlements } = await shiftActivity(input.storeId, input.shiftId);
    const drawer = summariseDrawer(shift, orders, refunds, settlements);

    const updated: LocalShift = {
      ...shift,
      status: "closed",
      closed_at: new Date().toISOString(),
      actual_cash: toDecimal(input.countedCash),
      // Kept as the till's own working figure. The server recomputes from the
      // payments ledger and sends its own back, which replaces this.
      expected_cash: toDecimal(drawer.expected),
      notes: input.notes?.trim() ? input.notes.trim() : shift.notes,
      _state: "pending",
    };

    await db.shifts.put(updated);
    await enqueue({
      storeId: input.storeId,
      entity: "register_shifts",
      action: "upsert",
      recordId: updated.id,
      payload: toPayload(updated),
    });

    return updated;
  });
}

/** The drawer this cashier currently has open on this till, if any. */
export async function currentShift(storeId: string, cashierUserId: string): Promise<LocalShift | undefined> {
  const rows = await db.shifts.where("store_id").equals(storeId).toArray();
  return rows.find((s) => s.status === "open" && s.cashier_user_id === cashierUserId);
}

/**
 * Sales and refunds booked against a shift on this till.
 *
 * Local-only by design. A drawer is a physical box at one terminal: another
 * till's sales were never in it, so counting them would guarantee a variance.
 */
export async function shiftActivity(
  storeId: string,
  shiftId: string,
): Promise<{ orders: LocalOrder[]; refunds: LocalReturn[]; settlements: LocalPayment[] }> {
  const [orders, refunds, settlements] = await Promise.all([
    db.orders.where("store_id").equals(storeId).toArray(),
    db.returns.where("store_id").equals(storeId).toArray(),
    db.payments.where("store_id").equals(storeId).toArray(),
  ]);

  const inThisShift = (id: string | null, state: string) => id === shiftId && state !== "discarded";

  return {
    // Discarded sales are excluded: a sale a manager threw away is not money in
    // the drawer, and counting it would leave the cashier short on paper.
    orders: orders.filter((o) => inThisShift(o.register_shift_id, o._state)),
    refunds: refunds.filter((r) => inThisShift(r.register_shift_id, r._state)),
    settlements: settlements.filter((p) => inThisShift(p.register_shift_id, p._state)),
  };
}

function toPayload(shift: LocalShift) {
  return {
    id: shift.id,
    cashier_user_id: shift.cashier_user_id,
    opened_at: shift.opened_at,
    closed_at: shift.closed_at,
    opening_float: shift.opening_float,
    cash_in: shift.cash_in,
    cash_out: shift.cash_out,
    actual_cash: shift.actual_cash,
    status: shift.status,
    notes: shift.notes,
    movements: shift.movements,
  };
}
