import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { SalesLineChart } from "@/src/components/organisms/SalesLineChart";
import { OrdersBarChart } from "@/src/components/organisms/OrdersBarChart";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { supabase } from "@/src/services/supabase";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";

type TimeRange = "7d" | "30d" | "90d";

export default function AnalyticsScreen() {
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const currency = useSettingsStore((s) => s.currency);
  const symbol = useMemo(() => (currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵"), [currency]);

  const [range, setRange] = useState<TimeRange>("30d");
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState({
    netSales: 0,
    grossSales: 0,
    totalOrders: 0,
    totalReturns: 0,
    avgTicket: 0,
  });

  const [salesChart, setSalesChart] = useState<{ label: string; value: number }[]>([]);
  const [barWeek, setBarWeek] = useState<{ label: string; sales: number; returns: number }[]>([]);
  const [bestSellers, setBestSellers] = useState<{ rank: number; name: string; unitsSold: number }[]>([]);

  const daysCount = range === "7d" ? 7 : range === "30d" ? 30 : 90;

  useEffect(() => {
    let mounted = true;
    async function loadAnalytics() {
      if (!activeStoreId) return;
      setLoading(true);

      const since = new Date();
      since.setDate(since.getDate() - (daysCount - 1));
      since.setHours(0, 0, 0, 0);

      const { data: orders } = await supabase
        .from("orders")
        .select("id, total, created_at")
        .eq("store_id", activeStoreId)
        .gte("created_at", since.toISOString());

      const { data: returns } = await supabase
        .from("returns")
        .select("amount, created_at")
        .eq("store_id", activeStoreId)
        .gte("created_at", since.toISOString());

      const { data: items } = await supabase
        .from("order_items")
        .select("product_name, quantity")
        .eq("store_id", activeStoreId)
        .gte("created_at", since.toISOString());

      const orderRows = orders ?? [];
      const returnRows = returns ?? [];
      const grossSales = orderRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
      const totalRefunds = returnRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
      const netSales = Math.max(0, grossSales - totalRefunds);
      const avgTicket = orderRows.length ? grossSales / orderRows.length : 0;

      // Chart days mapping (up to 7 data points)
      const chartPoints = Math.min(daysCount, 7);
      const chartDays = Array.from({ length: chartPoints }).map((_, idx) => {
        const d = new Date();
        d.setDate(d.getDate() - (chartPoints - 1 - idx));
        return d;
      });

      const line = chartDays.map((d) => {
        const key = d.toISOString().slice(0, 10);
        const value = orderRows
          .filter((o) => String(o.created_at).slice(0, 10) === key)
          .reduce((sum, o) => sum + Number(o.total ?? 0), 0);
        return { label: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3), value };
      });

      const bars = chartDays.map((d) => {
        const key = d.toISOString().slice(0, 10);
        const sales = orderRows.filter((o) => String(o.created_at).slice(0, 10) === key).length;
        const refunds = returnRows.filter((r) => String(r.created_at).slice(0, 10) === key).length;
        return { label: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1), sales, returns: refunds };
      });

      const soldMap = new Map<string, number>();
      (items ?? []).forEach((row) => {
        const name = String(row.product_name ?? "Unknown product");
        soldMap.set(name, (soldMap.get(name) ?? 0) + Number(row.quantity ?? 0));
      });

      const top = [...soldMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, unitsSold], idx) => ({ rank: idx + 1, name, unitsSold }));

      if (!mounted) return;

      setMetrics({
        netSales,
        grossSales,
        totalOrders: orderRows.length,
        totalReturns: returnRows.length,
        avgTicket,
      });
      setSalesChart(line);
      setBarWeek(bars);
      setBestSellers(top);
      setLoading(false);
    }

    void loadAnalytics();
    return () => {
      mounted = false;
    };
  }, [activeStoreId, daysCount]);

  const maxSold = useMemo(
    () => (bestSellers.length > 0 ? Math.max(...bestSellers.map((b) => b.unitsSold)) : 1),
    [bestSellers],
  );

  return (
    <AppScrollScreen
      title="Store Analytics"
      subtitle="Financial performance, sales velocity, and inventory insights."
    >
      {/* Time Range Selector */}
      <View style={styles.rangeSelectorContainer}>
        <Pressable
          style={[styles.rangePill, range === "7d" && styles.rangePillActive]}
          onPress={() => setRange("7d")}
        >
          <Text style={[styles.rangePillText, range === "7d" && styles.rangePillTextActive]}>7 Days</Text>
        </Pressable>
        <Pressable
          style={[styles.rangePill, range === "30d" && styles.rangePillActive]}
          onPress={() => setRange("30d")}
        >
          <Text style={[styles.rangePillText, range === "30d" && styles.rangePillTextActive]}>30 Days</Text>
        </Pressable>
        <Pressable
          style={[styles.rangePill, range === "90d" && styles.rangePillActive]}
          onPress={() => setRange("90d")}
        >
          <Text style={[styles.rangePillText, range === "90d" && styles.rangePillTextActive]}>90 Days</Text>
        </Pressable>
        {loading ? <ActivityIndicator size="small" color={Colors.primaryBlue} style={{ marginLeft: 8 }} /> : null}
      </View>

      {/* Hero KPI Grid */}
      <View style={styles.kpiGrid}>
        {/* Net Sales */}
        <View style={[styles.kpiCard, { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" }]}>
          <View style={styles.kpiTopRow}>
            <Text style={[styles.kpiTitle, { color: "#16a34a" }]}>Net Sales</Text>
            <Ionicons name="trending-up-outline" size={18} color="#16a34a" />
          </View>
          <Text style={[styles.kpiValue, { color: "#15803d" }]}>
            {symbol} {metrics.netSales.toFixed(2)}
          </Text>
          <Text style={styles.kpiSub}>Gross: {symbol}{metrics.grossSales.toFixed(2)}</Text>
        </View>

        {/* Total Orders */}
        <View style={[styles.kpiCard, { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" }]}>
          <View style={styles.kpiTopRow}>
            <Text style={[styles.kpiTitle, { color: "#2563eb" }]}>Total Orders</Text>
            <Ionicons name="bag-check-outline" size={18} color="#2563eb" />
          </View>
          <Text style={[styles.kpiValue, { color: "#1d4ed8" }]}>{metrics.totalOrders}</Text>
          <Text style={styles.kpiSub}>Completed transactions</Text>
        </View>

        {/* Average Ticket */}
        <View style={[styles.kpiCard, { backgroundColor: "#faf5ff", borderColor: "#e9d5ff" }]}>
          <View style={styles.kpiTopRow}>
            <Text style={[styles.kpiTitle, { color: "#9333ea" }]}>Avg. Ticket</Text>
            <Ionicons name="receipt-outline" size={18} color="#9333ea" />
          </View>
          <Text style={[styles.kpiValue, { color: "#7e22ce" }]}>
            {symbol} {metrics.avgTicket.toFixed(2)}
          </Text>
          <Text style={styles.kpiSub}>Per completed order</Text>
        </View>

        {/* Total Returns */}
        <View style={[styles.kpiCard, { backgroundColor: "#fff7ed", borderColor: "#fed7aa" }]}>
          <View style={styles.kpiTopRow}>
            <Text style={[styles.kpiTitle, { color: "#ea580c" }]}>Refunds / Returns</Text>
            <Ionicons name="return-down-back-outline" size={18} color="#ea580c" />
          </View>
          <Text style={[styles.kpiValue, { color: "#c2410c" }]}>{metrics.totalReturns}</Text>
          <Text style={styles.kpiSub}>Resolved refund cases</Text>
        </View>
      </View>

      {/* Revenue Line Chart */}
      <SectionCard>
        <View style={styles.chartHeader}>
          <View>
            <Text style={styles.sectionTitle}>Revenue Trend</Text>
            <Text style={styles.chartSub}>Daily sales velocity ({range.toUpperCase()})</Text>
          </View>
          <View style={styles.chartBadge}>
            <Text style={styles.chartBadgeText}>{symbol} {metrics.grossSales.toFixed(0)} Total</Text>
          </View>
        </View>
        <SalesLineChart data={salesChart} period={`Last ${daysCount} days`} />
      </SectionCard>

      {/* Orders vs Returns Bar Chart */}
      <SectionCard>
        <View style={styles.chartHeader}>
          <View>
            <Text style={styles.sectionTitle}>Orders vs. Returns</Text>
            <Text style={styles.chartSub}>Volume comparisons</Text>
          </View>
        </View>
        <OrdersBarChart data={barWeek} period={`Last ${daysCount} days`} />
      </SectionCard>

      {/* Top Best Selling Products */}
      <SectionCard>
        <View style={styles.chartHeader}>
          <View>
            <Text style={styles.sectionTitle}>Best Selling Products</Text>
            <Text style={styles.chartSub}>Top ranked items by units sold</Text>
          </View>
          <Ionicons name="trophy-outline" size={20} color={Colors.accentOrange} />
        </View>

        <View style={styles.bestSellersList}>
          {bestSellers.map((item) => {
            const percent = Math.min(100, Math.round((item.unitsSold / maxSold) * 100));
            const medal = item.rank === 1 ? "🥇" : item.rank === 2 ? "🥈" : item.rank === 3 ? "🥉" : `#${item.rank}`;
            return (
              <View key={`rank-${item.rank}`} style={styles.sellerRow}>
                <View style={styles.rankPill}>
                  <Text style={styles.rankPillText}>{medal}</Text>
                </View>

                <View style={styles.sellerDetails}>
                  <View style={styles.sellerTop}>
                    <Text style={styles.sellerName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.sellerUnits}>{item.unitsSold} units</Text>
                  </View>

                  {/* Progress Bar */}
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { width: `${percent}%` }]} />
                  </View>
                </View>
              </View>
            );
          })}

          {bestSellers.length === 0 ? (
            <Text style={styles.emptyNotice}>No product sales recorded in this time range.</Text>
          ) : null}
        </View>
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  rangeSelectorContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    padding: 4,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  rangePill: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: Radius.pill,
  },
  rangePillActive: {
    backgroundColor: Colors.primaryBlue,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  rangePillText: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  rangePillTextActive: {
    color: Colors.white,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  kpiCard: {
    width: "48%",
    flexGrow: 1,
    borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  kpiTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kpiTitle: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: "900",
    marginTop: 6,
    letterSpacing: -0.3,
  },
  kpiSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.title,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  chartSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 1,
  },
  chartBadge: {
    backgroundColor: Colors.primaryBluePale,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  chartBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  bestSellersList: {
    gap: Spacing.sm,
  },
  sellerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    padding: Spacing.sm,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: "#f1f5f9",
  },
  rankPill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  rankPillText: {
    fontSize: 14,
    fontWeight: "800",
  },
  sellerDetails: {
    flex: 1,
    gap: 4,
  },
  sellerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sellerName: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  sellerUnits: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: "#e2e8f0",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 6,
    backgroundColor: Colors.primaryBlue,
    borderRadius: 3,
  },
  emptyNotice: {
    textAlign: "center",
    color: Colors.textMuted,
    fontSize: 13,
    paddingVertical: Spacing.md,
  },
});
