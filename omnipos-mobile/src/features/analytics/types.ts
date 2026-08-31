export type TimeRange = "7d" | "30d" | "90d";

export type SalesSummary = {
  grossSales: number;
  netSales: number;
  orderCount: number;
  returnCount: number;
  returnAmount: number;
  avgTicket: number;
  cogs?: number;
  grossProfit?: number;
  profitMarginPercent?: number;
};

export type SalesTrendPoint = {
  label: string;
  value: number;
  dateKey: string;
};

export type OrderVsReturnPoint = {
  label: string;
  sales: number;
  returns: number;
  dateKey: string;
};

export type BestSellerProduct = {
  rank: number;
  name: string;
  unitsSold: number;
  revenue: number;
};

export type AnalyticsReport = {
  metrics: SalesSummary;
  salesChart: SalesTrendPoint[];
  barWeek: OrderVsReturnPoint[];
  bestSellers: BestSellerProduct[];
};

export type AnalyticsResponse = AnalyticsReport;
