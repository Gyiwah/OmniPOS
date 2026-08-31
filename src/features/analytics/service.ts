import { Q } from "@nozbe/watermelondb";
import { database } from "@/src/database";
import type Order from "@/src/database/models/Order";
import type OrderItem from "@/src/database/models/OrderItem";
import type Product from "@/src/database/models/Product";
import { supabase } from "@/src/services/supabase";
import type {
  AnalyticsReport,
  BestSellerProduct,
  OrderVsReturnPoint,
  SalesSummary,
  SalesTrendPoint,
  TimeRange,
} from "./types";

export const analyticsService = {
  async getStoreAnalytics(storeId: string, range: TimeRange = "30d"): Promise<AnalyticsReport> {
    if (!storeId) {
      return emptyReport();
    }

    const daysCount = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - (daysCount - 1));
    sinceDate.setHours(0, 0, 0, 0);
    const sinceTimestamp = sinceDate.getTime();

    // 1. Fetch Orders from local WatermelonDB
    let localOrders: Order[] = [];
    try {
      localOrders = await database
        .get<Order>("orders")
        .query(
          Q.where("store_id", storeId),
          Q.where("created_at", Q.gte(sinceTimestamp)),
        )
        .fetch();
    } catch {
      localOrders = [];
    }

    // 2. Fetch Order Items from local WatermelonDB
    let localItems: OrderItem[] = [];
    try {
      localItems = await database
        .get<OrderItem>("order_items")
        .query(Q.where("store_id", storeId))
        .fetch();
    } catch {
      localItems = [];
    }

    // Filter items belonging to the filtered orders
    const orderIdSet = new Set(localOrders.map((o) => o.id));
    const remoteIdSet = new Set(localOrders.map((o) => o.remoteId).filter(Boolean) as string[]);
    const relevantItems = localItems.filter(
      (item) => orderIdSet.has(item.orderId) || remoteIdSet.has(item.orderId),
    );

    // 3. Fetch Product Catalog for Cost Price calculation
    let productCostMap = new Map<string, number>();
    try {
      const products = await database
        .get<Product>("products")
        .query(Q.where("store_id", storeId))
        .fetch();
      products.forEach((p) => {
        if (p.costPrice && p.costPrice > 0) {
          productCostMap.set(p.id, p.costPrice);
          if (p.remoteId) productCostMap.set(p.remoteId, p.costPrice);
          if (p.name) productCostMap.set(p.name.trim().toLowerCase(), p.costPrice);
        }
      });
    } catch {
      // ignore
    }

    // 4. Check online Supabase returns (with graceful offline fallback)
    let returnRows: { amount: number; created_at: string }[] = [];
    try {
      const { data: returnsData, error } = await supabase
        .from("returns")
        .select("amount, created_at")
        .eq("store_id", storeId)
        .gte("created_at", sinceDate.toISOString());

      if (!error && returnsData) {
        returnRows = returnsData.map((r) => ({
          amount: Number(r.amount ?? 0),
          created_at: String(r.created_at),
        }));
      }
    } catch {
      // offline fallback
      returnRows = [];
    }

    // 5. Compute Metrics
    const grossSales = localOrders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
    const returnAmount = returnRows.reduce((sum, r) => sum + r.amount, 0);
    const netSales = Math.max(0, grossSales - returnAmount);
    const orderCount = localOrders.length;
    const returnCount = returnRows.length;
    const avgTicket = orderCount > 0 ? grossSales / orderCount : 0;

    // Compute Cost of Goods Sold (COGS) and Gross Margin
    let cogs = 0;
    relevantItems.forEach((item) => {
      const cost =
        (item.productId && productCostMap.get(item.productId)) ||
        productCostMap.get(item.productName.trim().toLowerCase()) ||
        0;
      cogs += cost * Number(item.quantity ?? 0);
    });

    const grossProfit = Math.max(0, netSales - cogs);
    const profitMarginPercent = grossSales > 0 ? (grossProfit / grossSales) * 100 : 0;

    const metrics: SalesSummary = {
      grossSales,
      netSales,
      orderCount,
      returnCount,
      returnAmount,
      avgTicket,
      cogs,
      grossProfit,
      profitMarginPercent,
    };

    // 6. Generate Chart Days (up to 7 or 14 points depending on range)
    const chartPoints = Math.min(daysCount, 7);
    const chartDays = Array.from({ length: chartPoints }).map((_, idx) => {
      const d = new Date();
      d.setDate(d.getDate() - (chartPoints - 1 - idx));
      return d;
    });

    const salesChart: SalesTrendPoint[] = chartDays.map((d) => {
      const key = d.toISOString().slice(0, 10);
      const value = localOrders
        .filter((o) => {
          const orderDate = new Date(o.createdAt).toISOString().slice(0, 10);
          return orderDate === key;
        })
        .reduce((sum, o) => sum + Number(o.total ?? 0), 0);

      return {
        label: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3),
        value,
        dateKey: key,
      };
    });

    const barWeek: OrderVsReturnPoint[] = chartDays.map((d) => {
      const key = d.toISOString().slice(0, 10);
      const sales = localOrders.filter((o) => {
        const orderDate = new Date(o.createdAt).toISOString().slice(0, 10);
        return orderDate === key;
      }).length;
      const returns = returnRows.filter((r) => r.created_at.slice(0, 10) === key).length;

      return {
        label: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1),
        sales,
        returns,
        dateKey: key,
      };
    });

    // 7. Aggregate Best Sellers
    const soldMap = new Map<string, { units: number; revenue: number }>();
    relevantItems.forEach((row) => {
      const name = String(row.productName ?? "Unknown product").trim();
      const current = soldMap.get(name) ?? { units: 0, revenue: 0 };
      current.units += Number(row.quantity ?? 0);
      current.revenue += Number(row.lineTotal ?? Number(row.unitPrice ?? 0) * Number(row.quantity ?? 0));
      soldMap.set(name, current);
    });

    const bestSellers: BestSellerProduct[] = [...soldMap.entries()]
      .sort((a, b) => b[1].units - a[1].units)
      .slice(0, 5)
      .map(([name, data], idx) => ({
        rank: idx + 1,
        name,
        unitsSold: data.units,
        revenue: data.revenue,
      }));

    return {
      metrics,
      salesChart,
      barWeek,
      bestSellers,
    };
  },

  async summary(storeId?: string): Promise<SalesSummary> {
    if (!storeId) {
      return { grossSales: 0, netSales: 0, orderCount: 0, returnAmount: 0, returnCount: 0, avgTicket: 0 };
    }
    const report = await this.getStoreAnalytics(storeId, "30d");
    return report.metrics;
  },
};

function emptyReport(): AnalyticsReport {
  return {
    metrics: {
      grossSales: 0,
      netSales: 0,
      orderCount: 0,
      returnCount: 0,
      returnAmount: 0,
      avgTicket: 0,
      cogs: 0,
      grossProfit: 0,
      profitMarginPercent: 0,
    },
    salesChart: [],
    barWeek: [],
    bestSellers: [],
  };
}
