export type DashboardData = {
  range: { from: string; to: string };
  sales: {
    gross: string;
    net: string;
    orders: number;
    average_order: string;
    refunds: string;
  };
  profit: {
    revenue_with_known_cost: string;
    cogs: string;
    gross_profit: string;
    margin_percent: string | null;
    lines_without_cost: number;
    lines_total: number;
  };
  low_stock_count: number;
  outstanding_debt: string;
  top_products: Array<{
    product_id: string;
    name: string;
    units: number;
    revenue: string;
  }>;
  payments_by_method: Record<string, { total: string; count: number }>;
};

export type SalesSeriesPoint = {
  period: string; // "YYYY-MM-DD"
  orders: number;
  gross: string;
  tax: string;
  discount: string;
};

export type SalesReportData = {
  range: { from: string; to: string };
  group_by: string;
  series: SalesSeriesPoint[];
  totals: {
    orders: number;
    gross: string;
  };
};

export type PeriodKey = "today" | "yesterday" | "7d" | "30d";

export type PeriodOption = {
  key: PeriodKey;
  label: string;
  days: number | null;
  isYesterday?: boolean;
};

export const PERIOD_OPTIONS: PeriodOption[] = [
  { key: "today", label: "Today", days: null },
  { key: "yesterday", label: "Yesterday", days: 1, isYesterday: true },
  { key: "7d", label: "Last 7 Days", days: 7 },
  { key: "30d", label: "Last 30 Days", days: 30 },
];

export type ExpiringBatchItem = {
  id: string;
  name: string;
  batch_number: string | null;
  quantity: string | number;
  expiry_date: string;
};

export type InventoryReportData = {
  low_stock: Array<{
    id: string;
    name: string;
    sku: string;
    stock: number;
    reorder_level: number;
  }>;
  oversold: Array<{
    id: string;
    name: string;
    sku: string;
    stock: number;
  }>;
  expiring_batches: ExpiringBatchItem[];
};

