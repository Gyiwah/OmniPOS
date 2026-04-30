import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { KPICard } from "@/src/components/molecules/KPICard";
import { AnalyticsCard } from "@/src/components/molecules/AnalyticsCard";
import { BestSellerRow } from "@/src/components/molecules/BestSellerRow";
import { SalesLineChart } from "@/src/components/organisms/SalesLineChart";
import { OrdersBarChart } from "@/src/components/organisms/OrdersBarChart";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { supabase } from "@/src/services/supabase";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";

export default function AnalyticsScreen() {
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const currency = useSettingsStore((s) => s.currency);
  const [kpis, setKpis] = useState([
    { title: "Net sales", value: "₵ 0.00", period: "Last 7 days", variant: "primary" as const },
    { title: "Orders", value: "0", period: "Last 7 days", variant: "accent" as const },
    { title: "Avg. ticket", value: "₵ 0.00", period: "Per completed sale", variant: "success" as const },
  ]);
  const [salesChart, setSalesChart] = useState<{ label: string; value: number }[]>([]);
  const [barWeek, setBarWeek] = useState<{ label: string; sales: number; returns: number }[]>([]);
  const [bestSellers, setBestSellers] = useState<{ rank: number; imageUrl: string | null; name: string; unitsSold: number }[]>([]);
  const symbol = useMemo(() => (currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵"), [currency]);

  useEffect(() => {
    let mounted = true;
    async function loadAnalytics() {
      if (!activeStoreId) return;
      const since = new Date();
      since.setDate(since.getDate() - 29);

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
      const orderTotal = orderRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
      const returnTotal = returnRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
      const netSales = Math.max(0, orderTotal - returnTotal);
      const avgTicket = orderRows.length ? orderTotal / orderRows.length : 0;

      const weekDays = Array.from({ length: 7 }).map((_, idx) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - idx));
        return d;
      });
      const line = weekDays.map((d) => {
        const key = d.toISOString().slice(0, 10);
        const value = orderRows
          .filter((o) => String(o.created_at).slice(0, 10) === key)
          .reduce((sum, o) => sum + Number(o.total ?? 0), 0);
        return { label: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3), value };
      });
      const bars = weekDays.map((d) => {
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
        .map(([name, unitsSold], idx) => ({ rank: idx + 1, imageUrl: null, name, unitsSold }));

      if (!mounted) return;
      setKpis([
        { title: "Net sales", value: `${symbol} ${netSales.toFixed(2)}`, period: "Last 30 days", variant: "primary" },
        { title: "Orders", value: String(orderRows.length), period: "Last 30 days", variant: "accent" },
        { title: "Avg. ticket", value: `${symbol} ${avgTicket.toFixed(2)}`, period: "Per completed sale", variant: "success" },
      ]);
      setSalesChart(line);
      setBarWeek(bars);
      setBestSellers(top);
    }
    void loadAnalytics();
    return () => {
      mounted = false;
    };
  }, [activeStoreId, symbol]);

  return (
    <AppScrollScreen title="Analytics">
      <View style={styles.kpiRow}>
        {kpis.map((k) => (
          <View key={k.title} style={styles.kpiCell}>
            <KPICard title={k.title} value={k.value} period={k.period} variant={k.variant} />
          </View>
        ))}
      </View>

      <SectionCard>
        <Text style={styles.sectionTitle}>Revenue</Text>
        <SalesLineChart data={salesChart} period="Trailing 7 days" />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Orders vs returns</Text>
        <OrdersBarChart data={barWeek} period="This week" />
      </SectionCard>

      <AnalyticsCard title="Category mix" period="Last 30 days" averageLabel={<Text style={styles.k}>Avg</Text>}>
        <Text style={styles.body}>Grocery 42% · Beverages 28% · Household 18% · Other 12%</Text>
      </AnalyticsCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Best sellers</Text>
        <View style={styles.list}>
          {bestSellers.map((b) => (
            <BestSellerRow
              key={`seller-${b.rank}`}
              rank={b.rank}
              imageUrl={b.imageUrl}
              name={b.name}
              unitsSold={b.unitsSold}
            />
          ))}
          {bestSellers.length === 0 ? <Text style={styles.body}>No product sales data yet.</Text> : null}
        </View>
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  kpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  kpiCell: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 100,
  },
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  body: {
    ...Typography.body,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  k: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  list: {
    gap: 2,
  },
});
