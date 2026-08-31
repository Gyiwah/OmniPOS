export type CashMovement = {
  id: string;
  type: "in" | "out";
  amount: number;
  reason: string;
  timestamp: number;
};

export type ShiftRecord = {
  id: string;
  storeId: string;
  cashierUserId: string;
  openedAt: number;
  closedAt?: number | null;
  openingFloat: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  actualCash?: number | null;
  discrepancy?: number | null;
  status: "open" | "closed";
  notes?: string | null;
  movements: CashMovement[];
};

export type ShiftSummary = {
  shift: ShiftRecord;
  totalOrders: number;
  totalSales: number;
  cashSales: number;
  cardSales: number;
  momoSales: number;
  otherSales: number;
  totalDiscounts: number;
  totalTax: number;
  netCashExpected: number;
};

export type ZReportData = ShiftSummary & {
  storeName?: string;
  cashierName?: string;
  generatedAt: string;
};
