import { Q } from "@nozbe/watermelondb";
import { uuidv7 } from "@/src/core/ids";
import { database } from "@/src/database";
import RegisterShift from "@/src/database/models/RegisterShift";
import Order from "@/src/database/models/Order";
import { enqueueChange } from "@/src/sync/enqueue";
import type { CashMovement, ShiftRecord, ShiftSummary, ZReportData } from "./types";

function parseMovements(raw?: string | null): CashMovement[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toShiftRecord(m: RegisterShift): ShiftRecord {
  return {
    id: m.id,
    storeId: m.storeId,
    cashierUserId: m.cashierUserId,
    openedAt: m.openedAt,
    closedAt: m.closedAt ?? null,
    openingFloat: Number(m.openingFloat ?? 0),
    cashSales: Number(m.cashSales ?? 0),
    cashIn: Number(m.cashIn ?? 0),
    cashOut: Number(m.cashOut ?? 0),
    expectedCash: Number(m.expectedCash ?? 0),
    actualCash: m.actualCash !== undefined && m.actualCash !== null ? Number(m.actualCash) : null,
    discrepancy: m.discrepancy !== undefined && m.discrepancy !== null ? Number(m.discrepancy) : null,
    status: (m.status as "open" | "closed") || "open",
    notes: m.notes ?? null,
    movements: parseMovements(m.movementsJson),
  };
}

export async function getActiveShift(storeId: string, cashierUserId?: string): Promise<ShiftRecord | null> {
  try {
    const conditions = [Q.where("store_id", storeId), Q.where("status", "open")];
    if (cashierUserId) {
      conditions.push(Q.where("cashier_user_id", cashierUserId));
    }
    const shifts = await database
      .get<RegisterShift>("register_shifts")
      .query(...conditions, Q.sortBy("opened_at", Q.desc))
      .fetch();

    if (shifts.length > 0) {
      return toShiftRecord(shifts[0]);
    }
  } catch (err) {
    if (__DEV__) console.warn(`[OmniPOS] getActiveShift error: ${err}`);
  }
  return null;
}

export async function openShift(
  storeId: string,
  cashierUserId: string,
  openingFloat: number,
  notes?: string,
): Promise<ShiftRecord> {
  const existing = await getActiveShift(storeId, cashierUserId);
  if (existing) {
    return existing;
  }

  const now = Date.now();
  let created: RegisterShift;

  await database.write(async () => {
    created = await database.get<RegisterShift>("register_shifts").create((rec) => {
      rec.storeId = storeId;
      rec.cashierUserId = cashierUserId;
      rec.openedAt = now;
      rec.openingFloat = Number(openingFloat) || 0;
      rec.cashSales = 0;
      rec.cashIn = 0;
      rec.cashOut = 0;
      rec.expectedCash = Number(openingFloat) || 0;
      rec.status = "open";
      rec.notes = notes || undefined;
      rec.movementsJson = JSON.stringify([]);
      rec.dirty = true;
    });
  });

  const record = toShiftRecord(created!);

  void enqueueChange({
    storeId,
    entity: "register_shifts",
    operation: "insert",
    recordId: record.id,
    payload: {
      id: record.id,
      store_id: storeId,
      cashier_user_id: cashierUserId,
      opened_at: new Date(record.openedAt).toISOString(),
      opening_float: record.openingFloat,
      expected_cash: record.expectedCash,
      status: "open",
      notes: record.notes,
    },
  });

  return record;
}

export async function recordCashMovement(
  shiftId: string,
  type: "in" | "out",
  amount: number,
  reason: string,
): Promise<ShiftRecord> {
  const shift = await database.get<RegisterShift>("register_shifts").find(shiftId);
  if (!shift || shift.status !== "open") {
    throw new Error("Cannot record cash movement on a closed or missing shift.");
  }

  const numericAmount = Math.max(0, Number(amount) || 0);
  const movements = parseMovements(shift.movementsJson);
  const newMovement: CashMovement = {
    id: uuidv7(),
    type,
    amount: numericAmount,
    reason: reason.trim() || (type === "in" ? "Cash In" : "Cash Out"),
    timestamp: Date.now(),
  };
  movements.push(newMovement);

  const nextCashIn = type === "in" ? Number(shift.cashIn ?? 0) + numericAmount : Number(shift.cashIn ?? 0);
  const nextCashOut = type === "out" ? Number(shift.cashOut ?? 0) + numericAmount : Number(shift.cashOut ?? 0);
  const nextExpected = Number(shift.openingFloat ?? 0) + Number(shift.cashSales ?? 0) + nextCashIn - nextCashOut;

  await database.write(async () => {
    await shift.update((rec) => {
      rec.cashIn = nextCashIn;
      rec.cashOut = nextCashOut;
      rec.expectedCash = nextExpected;
      rec.movementsJson = JSON.stringify(movements);
      rec.dirty = true;
    });
  });

  const record = toShiftRecord(shift);

  void enqueueChange({
    storeId: shift.storeId,
    entity: "register_shifts",
    operation: "upsert",
    recordId: shift.id,
    payload: {
      id: shift.id,
      store_id: shift.storeId,
      cash_in: nextCashIn,
      cash_out: nextCashOut,
      expected_cash: nextExpected,
      movements: movements,
    },
  });

  return record;
}

export async function getShiftSummary(shiftId: string): Promise<ShiftSummary> {
  const shift = await database.get<RegisterShift>("register_shifts").find(shiftId);
  const shiftRec = toShiftRecord(shift);

  const shiftEnd = shift.closedAt || Date.now();
  const orders = await database
    .get<Order>("orders")
    .query(
      Q.where("store_id", shift.storeId),
      Q.where("created_at", Q.gte(shift.openedAt)),
      Q.where("created_at", Q.lte(shiftEnd)),
    )
    .fetch();

  let totalSales = 0;
  let cashSales = 0;
  let cardSales = 0;
  let momoSales = 0;
  let otherSales = 0;
  let totalDiscounts = 0;
  let totalTax = 0;

  for (const o of orders) {
    if (o.status === "voided") continue;
    const ordTotal = Number(o.total ?? 0);
    const paid = Number(o.amountPaid ?? ordTotal);
    const method = String(o.paymentMethod || "cash").toLowerCase();

    totalSales += ordTotal;
    totalDiscounts += Number(o.discount ?? 0);
    totalTax += Number(o.tax ?? 0);

    if (method === "cash") {
      cashSales += paid;
    } else if (method === "card") {
      cardSales += paid;
    } else if (method === "momo" || method === "mobile_money") {
      momoSales += paid;
    } else {
      otherSales += paid;
    }
  }

  const netCashExpected = shiftRec.openingFloat + cashSales + shiftRec.cashIn - shiftRec.cashOut;

  // Sync cashSales into shift record if modified
  if (Math.abs(shift.cashSales - cashSales) > 0.01 || Math.abs(shift.expectedCash - netCashExpected) > 0.01) {
    await database.write(async () => {
      await shift.update((rec) => {
        rec.cashSales = cashSales;
        rec.expectedCash = netCashExpected;
      });
    });
    shiftRec.cashSales = cashSales;
    shiftRec.expectedCash = netCashExpected;
  }

  return {
    shift: shiftRec,
    totalOrders: orders.length,
    totalSales,
    cashSales,
    cardSales,
    momoSales,
    otherSales,
    totalDiscounts,
    totalTax,
    netCashExpected,
  };
}

export async function closeShift(shiftId: string, actualCash: number, notes?: string): Promise<ShiftRecord> {
  const summary = await getShiftSummary(shiftId);
  const shift = await database.get<RegisterShift>("register_shifts").find(shiftId);
  const now = Date.now();
  const counted = Number(actualCash) || 0;
  const discrepancy = counted - summary.netCashExpected;

  await database.write(async () => {
    await shift.update((rec) => {
      rec.status = "closed";
      rec.closedAt = now;
      rec.actualCash = counted;
      rec.expectedCash = summary.netCashExpected;
      rec.discrepancy = discrepancy;
      if (notes) rec.notes = notes;
      rec.dirty = true;
    });
  });

  const record = toShiftRecord(shift);

  void enqueueChange({
    storeId: shift.storeId,
    entity: "register_shifts",
    operation: "upsert",
    recordId: shift.id,
    payload: {
      id: shift.id,
      store_id: shift.storeId,
      status: "closed",
      closed_at: new Date(now).toISOString(),
      actual_cash: counted,
      expected_cash: summary.netCashExpected,
      discrepancy,
      notes: record.notes,
    },
  });

  return record;
}

export async function generateZReport(
  shiftId: string,
  storeName = "OmniPOS Store",
  cashierName = "Cashier",
): Promise<ZReportData> {
  const summary = await getShiftSummary(shiftId);
  return {
    ...summary,
    storeName,
    cashierName,
    generatedAt: new Date().toISOString(),
  };
}

export async function listShifts(storeId: string): Promise<ShiftRecord[]> {
  try {
    const rows = await database
      .get<RegisterShift>("register_shifts")
      .query(Q.where("store_id", storeId), Q.sortBy("opened_at", Q.desc))
      .fetch();

    return rows.map(toShiftRecord);
  } catch {
    return [];
  }
}

export const shiftsService = {
  getActive: getActiveShift,
  open: openShift,
  recordMovement: recordCashMovement,
  getSummary: getShiftSummary,
  close: closeShift,
  generateZReport,
  list: listShifts,
};
