import { api } from "@/src/core/api/client";
import type {
  AnalyticsReport,
  BestSellerProduct,
  OrderVsReturnPoint,
  SalesSummary,
  SalesTrendPoint,
  TimeRange,
} from "./types";

/**
 * Analytics, over the Laravel API.
 *
 * These figures cover every till in the store, which is precisely why they come
 * from the server: one terminal's local database only knows its own sales, so
 * computing them locally would quietly report a fraction of the business.
 *
 * That also means analytics is the one screen that genuinely needs a
 * connection. Callers should say so rather than showing a number that looks
 * complete and is not.
 */

type DashboardResponse = {
  sales: { gross: string; net: string; orders: number; average_order: string; refunds: string };
  profit: { cogs: string; gross_profit: string; margin_percent: string | null };
  top_products: Array<{ product_id: string; name: string; units: number; revenue: string }>;
};

type SalesResponse = {
  series: Array<{ period: string; orders: number; gross: string }>;
  totals: { orders: number; gross: string };
};

function daysFor(range: TimeRange): number {
  return range === "7d" ? 7 : range === "90d" ? 90 : 30;
}

function rangeToDates(range: TimeRange): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - daysFor(range));

  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function shortLabel(isoDate: string): string {
  const d = new Date(isoDate);
  return Number.isNaN(d.getTime()) ? isoDate : `${d.getDate()}/${d.getMonth() + 1}`;
}

/**
 * Profit is only reported when the caller is allowed to see cost prices. The
 * server returns 403 for a cashier, which is not an error worth surfacing on a
 * dashboard — the rest of the figures are still valid, so the profit fields are
 * simply absent.
 */
async function fetchDashboard(from: string, to: string): Promise<DashboardResponse | null> {
  try {
    return await api.get<DashboardResponse>("/api/reports/dashboard", { from, to });
  } catch {
    return null;
  }
}

export const laravelAnalyticsService = {
  async getStoreAnalytics(_storeId: string, range: TimeRange = "30d"): Promise<AnalyticsReport> {
    const { from, to } = rangeToDates(range);

    const [sales, dashboard] = await Promise.all([
      api.get<SalesResponse>("/api/reports/sales", { from, to, group_by: "day" }),
      fetchDashboard(from, to),
    ]);

    const series = sales.series ?? [];

    const salesChart: SalesTrendPoint[] = series.map((point) => ({
      label: shortLabel(point.period),
      value: Number(point.gross),
      dateKey: point.period,
    }));

    // The server's sales series does not carry refunds per period, so the
    // returns column is reported as zero rather than invented. The totals below
    // do include refunds, which is where the number actually matters.
    const barWeek: OrderVsReturnPoint[] = series.slice(-7).map((point) => ({
      label: shortLabel(point.period),
      sales: point.orders,
      returns: 0,
      dateKey: point.period,
    }));

    const bestSellers: BestSellerProduct[] = (dashboard?.top_products ?? []).map((p, index) => ({
      rank: index + 1,
      name: p.name,
      unitsSold: p.units,
      revenue: Number(p.revenue),
    }));

    const gross = Number(dashboard?.sales.gross ?? sales.totals?.gross ?? 0);
    const refunds = Number(dashboard?.sales.refunds ?? 0);
    const orders = dashboard?.sales.orders ?? sales.totals?.orders ?? 0;

    const metrics: SalesSummary = {
      grossSales: gross,
      netSales: Number(dashboard?.sales.net ?? gross - refunds),
      orderCount: orders,
      // The server reports refund value, not a count of returns; reporting the
      // amount here would be a different number under the same name.
      returnCount: 0,
      returnAmount: refunds,
      avgTicket: Number(dashboard?.sales.average_order ?? (orders > 0 ? gross / orders : 0)),
      cogs: dashboard ? Number(dashboard.profit.cogs) : undefined,
      grossProfit: dashboard ? Number(dashboard.profit.gross_profit) : undefined,
      profitMarginPercent:
        dashboard?.profit.margin_percent != null ? Number(dashboard.profit.margin_percent) : undefined,
    };

    return { metrics, salesChart, barWeek, bestSellers };
  },

  async summary(_storeId?: string): Promise<SalesSummary> {
    const report = await this.getStoreAnalytics(_storeId ?? "", "30d");
    return report.metrics;
  },
};
