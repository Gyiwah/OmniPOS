import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Q } from "@nozbe/watermelondb";

import { Avatar } from "@/src/components/atoms/Avatar";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { KPICard } from "@/src/components/molecules/KPICard";
import { OrdersBarChart } from "@/src/components/organisms/OrdersBarChart";
import { SalesLineChart } from "@/src/components/organisms/SalesLineChart";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { useManualSync } from "@/src/hooks/useManualSync";
import { supabase } from "@/src/services/supabase";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";
import { database } from "@/src/database";
import type Product from "@/src/database/models/Product";
import type Order from "@/src/database/models/Order";
import type OrderItem from "@/src/database/models/OrderItem";
import type Customer from "@/src/database/models/Customer";
import { formatRelativeSyncTime } from "@/src/utils/date";

const SHORTCUTS: {
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  href: "/inventory" | "/product/add" | "/pos/add-order" | "/analytics" | "/returns" | "/customers" | "/pos/shifts";
}[] = [
  {
    label: "Create Order",
    subtitle: "POS sale & checkout",
    icon: "cart-outline",
    color: "#2563eb",
    bg: "#eff6ff",
    href: "/pos/add-order",
  },
  {
    label: "Cash Drawer",
    subtitle: "Shifts & Z-Reports",
    icon: "cash-outline",
    color: "#0284c7",
    bg: "#e0f2fe",
    href: "/pos/shifts",
  },
  {
    label: "Inventory",
    subtitle: "Stock & batch tracking",
    icon: "cube-outline",
    color: "#059669",
    bg: "#ecfdf5",
    href: "/inventory",
  },
  {
    label: "Add Product",
    subtitle: "New catalog item",
    icon: "add-circle-outline",
    color: "#7c3aed",
    bg: "#f5f3ff",
    href: "/product/add",
  },
  {
    label: "Customers CRM",
    subtitle: "Accounts & credit",
    icon: "people-outline",
    color: "#d97706",
    bg: "#fffbeb",
    href: "/customers",
  },
  {
    label: "Returns",
    subtitle: "Refund & restock",
    icon: "refresh-outline",
    color: "#e11d48",
    bg: "#fff1f2",
    href: "/returns",
  },
  {
    label: "Analytics",
    subtitle: "Sales & revenue charts",
    icon: "trending-up-outline",
    color: "#0891b2",
    bg: "#ecfeff",
    href: "/analytics",
  },
];

const LANGUAGES = ["English", "French", "Spanish"] as const;
const CURRENCIES = ["GHS", "USD", "NGN"] as const;

type RecentTransaction = {
  id: string;
  orderNumber: string;
  customerName?: string;
  total: number;
  amountPaid: number;
  status: string;
  createdAt: number | string;
};

type TopProduct = {
  name: string;
  quantity: number;
  revenue: number;
};

export default function HomeScreen() {
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [kpis, setKpis] = useState<
    { title: string; value: string; period: string; variant: "primary" | "accent" | "success" }[]
  >([
    { title: "Today's Sales", value: "₵ 0.00", period: "Today's revenue", variant: "primary" },
    { title: "Orders Today", value: "0", period: "Completed tickets", variant: "accent" },
    { title: "Est. Gross Profit", value: "₵ 0.00", period: "Gross profit margin", variant: "success" },
    { title: "Credit Receivables", value: "₵ 0.00", period: "Unpaid customer credit", variant: "accent" },
  ]);
  const [salesChart, setSalesChart] = useState<{ label: string; value: number }[]>([]);
  const [barWeek, setBarWeek] = useState<{ label: string; sales: number; returns: number }[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);

  const {
    shopName,
    shopEmail,
    shopLogoUri,
    language,
    currency,
    appModeDark,
    setAppModeDark,
    setLanguage,
    setCurrency,
    setShopProfile,
  } = useSettingsStore();
  const { triggerSync, syncing, pendingCount, lastSyncedAt, syncStatus, lastError } = useManualSync();

  const currencySymbol = useMemo(() => {
    if (currency === "USD") return "$";
    if (currency === "NGN") return "₦";
    return "₵";
  }, [currency]);

  const syncPillLabel = useMemo(() => {
    if (syncing) return "Syncing";
    if (syncStatus === "error") return "Retry";
    if (pendingCount > 0) return `Sync · ${pendingCount}`;
    return "Sync";
  }, [pendingCount, syncStatus, syncing]);

  const heroSub = useMemo(() => {
    const pendingLabel =
      pendingCount === 0 ? "All changes synced" : `${pendingCount} change${pendingCount === 1 ? "" : "s"} pending`;
    const syncedLabel = `Last synced ${formatRelativeSyncTime(lastSyncedAt)}`;
    return `${pendingLabel} · ${syncedLabel} · ${language} · ${currencySymbol}`;
  }, [currencySymbol, language, lastSyncedAt, pendingCount]);

  const [lowStockCount, setLowStockCount] = useState(0);
  const [expiredBatchCount, setExpiredBatchCount] = useState(0);
  const [expiringSoonBatchCount, setExpiringSoonBatchCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function loadDashboard() {
      if (!activeStoreId) return;

      // 1. Inventory & Batch Health
      try {
        const allProducts = await database.get<Product>("products").query().fetch();
        const lowStockItems = allProducts.filter(
          (p) => p.storeId === activeStoreId && Number(p.stock ?? 0) <= Number(p.reorderLevel ?? 5),
        );
        if (mounted) setLowStockCount(lowStockItems.length);

        const { getExpiringBatchesSummary } = await import("@/src/features/inventory/batchService");
        const expSummary = await getExpiringBatchesSummary(activeStoreId, 30);
        if (mounted) {
          setExpiredBatchCount(expSummary.expiredCount);
          setExpiringSoonBatchCount(expSummary.expiringSoonCount);
        }
      } catch {
        // ignore
      }

      // 2. Fetch Orders & Return Metrics
      const since7d = new Date();
      since7d.setDate(since7d.getDate() - 6);
      since7d.setHours(0, 0, 0, 0);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      try {
        // Query local WatermelonDB Orders
        const localOrders = await database
          .get<Order>("orders")
          .query(Q.where("store_id", activeStoreId))
          .fetch();

        const localCustomers = await database
          .get<Customer>("customers")
          .query(Q.where("store_id", activeStoreId))
          .fetch();

        const totalReceivables = localCustomers.reduce(
          (sum, c) => sum + Number(c.outstandingBalance ?? 0),
          0
        );

        // Fetch Supabase data if available
        const { data: cloudOrders } = await supabase
          .from("orders")
          .select("id, order_number, total, amount_paid, status, customer_name, created_at")
          .eq("store_id", activeStoreId)
          .gte("created_at", since7d.toISOString());

        const { data: cloudReturns } = await supabase
          .from("returns")
          .select("amount, created_at")
          .eq("store_id", activeStoreId)
          .gte("created_at", since7d.toISOString());

        const orderRows = cloudOrders && cloudOrders.length > 0 ? cloudOrders : localOrders.map((o) => ({
          id: o.id,
          order_number: o.orderNumber,
          total: Number(o.total ?? 0),
          amount_paid: Number(o.amountPaid ?? 0),
          status: o.status,
          customer_name: o.customerName ?? undefined,
          created_at: typeof o.createdAt === "number" ? new Date(o.createdAt).toISOString() : String(o.createdAt),
        }));

        const returnRows = cloudReturns ?? [];

        // Today's Sales calculation
        const todayOrders = orderRows.filter(
          (o) => new Date(o.created_at).getTime() >= todayStart.getTime()
        );
        const todaySales = todayOrders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
        const todayEstimatedProfit = todaySales * 0.28; // Estimated average retail profit margin

        // 7-day Day Keys & Charts
        const dayKeys = Array.from({ length: 7 }).map((_, idx) => {
          const d = new Date();
          d.setDate(d.getDate() - (6 - idx));
          return d;
        });

        const line = dayKeys.map((d) => {
          const key = d.toISOString().slice(0, 10);
          const value = orderRows
            .filter((o) => String(o.created_at).slice(0, 10) === key)
            .reduce((sum, o) => sum + Number(o.total ?? 0), 0);
          return { label: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3), value };
        });

        const bar = dayKeys.map((d) => {
          const key = d.toISOString().slice(0, 10);
          const sales = orderRows.filter((o) => String(o.created_at).slice(0, 10) === key).length;
          const refunds = returnRows.filter((r) => String(r.created_at).slice(0, 10) === key).length;
          return { label: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1), sales, returns: refunds };
        });

        // Recent 4 Transactions
        const sortedRecent: RecentTransaction[] = [...orderRows]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 4)
          .map((o) => ({
            id: o.id,
            orderNumber: o.order_number,
            customerName: o.customer_name,
            total: Number(o.total ?? 0),
            amountPaid: Number(o.amount_paid ?? 0),
            status: o.status,
            createdAt: o.created_at,
          }));

        // Compute Top Products from Local OrderItems
        const localOrderItems = await database
          .get<OrderItem>("order_items")
          .query(Q.where("store_id", activeStoreId))
          .fetch();

        const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
        for (const item of localOrderItems) {
          const current = productMap.get(item.productName) ?? { name: item.productName, quantity: 0, revenue: 0 };
          current.quantity += Number(item.quantity ?? 0);
          current.revenue += Number(item.lineTotal ?? 0);
          productMap.set(item.productName, current);
        }

        const topRanking = Array.from(productMap.values())
          .sort((a, b) => b.quantity - a.quantity)
          .slice(0, 3);

        if (!mounted) return;

        setKpis([
          {
            title: "Today's Sales",
            value: `${currencySymbol} ${todaySales.toFixed(2)}`,
            period: "Today's net revenue",
            variant: "primary",
          },
          {
            title: "Orders Today",
            value: String(todayOrders.length),
            period: "Completed sales",
            variant: "accent",
          },
          {
            title: "Est. Gross Profit",
            value: `${currencySymbol} ${todayEstimatedProfit.toFixed(2)}`,
            period: "~28% retail margin",
            variant: "success",
          },
          {
            title: "Credit Receivables",
            value: `${currencySymbol} ${totalReceivables.toFixed(2)}`,
            period: "Outstanding client credit",
            variant: "accent",
          },
        ]);

        setSalesChart(line);
        setBarWeek(bar);
        setRecentTransactions(sortedRecent);
        setTopProducts(topRanking);
      } catch {
        // ignore
      }
    }

    void loadDashboard();
    return () => {
      mounted = false;
    };
  }, [activeStoreId, currencySymbol]);

  if (!activeStoreId) return <Redirect href="/onboarding/store" />;

  async function changeLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      setShopProfile({ logoUri: result.assets[0]?.uri ?? null });
    }
  }

  return (
    <>
      <AppScrollScreen
        title={shopName}
        subtitle={`Executive POS Dashboard · ${currency} active`}
        left={
          <Pressable style={styles.shopAvatarBtn} onPress={() => setDrawerOpen(true)} hitSlop={10}>
            <Avatar uri={shopLogoUri} fallbackInitials={shopName} size={38} />
          </Pressable>
        }
        right={
          <Pressable
            style={[
              styles.syncPill,
              syncStatus === "error" && styles.syncPillError,
              pendingCount > 0 && syncStatus !== "error" && styles.syncPillPending,
            ]}
            onPress={() => void triggerSync()}
            disabled={syncing}
            accessibilityRole="button"
            accessibilityLabel={syncPillLabel}
          >
            <View style={styles.syncPillInner}>
              {syncing ? <ActivityIndicator size="small" color={Colors.primaryBlue} /> : null}
              <Text
                style={[
                  styles.syncLabel,
                  syncStatus === "error" && styles.syncLabelError,
                ]}
              >
                {syncPillLabel}
              </Text>
            </View>
          </Pressable>
        }
      >
        {/* Welcome Header */}
        <SectionCard style={styles.heroCard}>
          <View style={styles.heroRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.liveTagRow}>
                <View style={styles.liveIndicatorDot} />
                <Text style={styles.liveTagText}>STORE ONLINE</Text>
              </View>
              <Text style={styles.heroTitle}>{shopName}</Text>
              <Text style={styles.heroSub}>{heroSub}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.newSaleHeroBtn, pressed && { opacity: 0.85 }]}
              onPress={() => router.push("/pos/add-order")}
            >
              <Ionicons name="cart" size={18} color={Colors.white} />
              <Text style={styles.newSaleHeroText}>New Sale</Text>
            </Pressable>
          </View>

          {syncStatus === "error" && lastError ? (
            <Text style={styles.syncError}>{lastError}</Text>
          ) : null}
        </SectionCard>

        {/* Expiry Alert Card */}
        {expiredBatchCount > 0 || expiringSoonBatchCount > 0 ? (
          <Pressable onPress={() => router.push("/inventory")}>
            <SectionCard style={styles.expiryAlertCard}>
              <View style={styles.lowStockRow}>
                <Ionicons name="time-outline" size={22} color="#dc2626" />
                <View style={styles.lowStockTextWrap}>
                  <Text style={styles.expiryAlertTitle}>Batch Expiry Alert</Text>
                  <Text style={styles.expiryAlertSub}>
                    {expiredBatchCount > 0 ? `${expiredBatchCount} batch(es) expired.` : ""}
                    {expiredBatchCount > 0 && expiringSoonBatchCount > 0 ? " " : ""}
                    {expiringSoonBatchCount > 0 ? `${expiringSoonBatchCount} batch(es) expiring soon (<30d).` : ""}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </View>
            </SectionCard>
          </Pressable>
        ) : null}

        {/* Low Stock Reorder Card */}
        {lowStockCount > 0 ? (
          <Pressable onPress={() => router.push("/inventory")}>
            <SectionCard style={styles.lowStockCard}>
              <View style={styles.lowStockRow}>
                <Ionicons name="warning-outline" size={22} color="#d97706" />
                <View style={styles.lowStockTextWrap}>
                  <Text style={styles.lowStockTitle}>Low Stock Warning</Text>
                  <Text style={styles.lowStockSub}>
                    {lowStockCount} product{lowStockCount > 1 ? "s are" : " is"} at or below reorder level. Tap to restock.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </View>
            </SectionCard>
          </Pressable>
        ) : null}

        {/* Executive KPI Deck Grid */}
        <View style={styles.kpiGrid}>
          {kpis.map((k) => (
            <View key={k.title} style={styles.kpiGridCell}>
              <KPICard
                title={k.title}
                value={k.value}
                period={k.period}
                variant={k.variant}
              />
            </View>
          ))}
        </View>

        {/* Sales Performance Chart */}
        <SectionCard>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleWithIcon}>
              <Ionicons name="trending-up" size={18} color={Colors.primaryBlue} />
              <Text style={styles.sectionTitle}>7-Day Revenue Velocity</Text>
            </View>
            <Text style={styles.sectionHeaderBadge}>Live Chart</Text>
          </View>
          <SalesLineChart data={salesChart} period="Last 7 days" />
        </SectionCard>

        {/* Orders vs Returns Volume */}
        <SectionCard>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleWithIcon}>
              <Ionicons name="bar-chart" size={18} color={Colors.accentOrange} />
              <Text style={styles.sectionTitle}>Orders vs Returns Volume</Text>
            </View>
            <Text style={styles.sectionHeaderBadge}>This week</Text>
          </View>
          <OrdersBarChart data={barWeek} period="This week" />
        </SectionCard>

        {/* Top Selling Products Ranking */}
        {topProducts.length > 0 ? (
          <SectionCard>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleWithIcon}>
                <Ionicons name="flame" size={18} color={Colors.accentOrange} />
                <Text style={styles.sectionTitle}>Top Selling Products</Text>
              </View>
              <Pressable onPress={() => router.push("/inventory")}>
                <Text style={styles.seeAllLink}>View All</Text>
              </Pressable>
            </View>

            <View style={styles.topProductsList}>
              {topProducts.map((p, idx) => (
                <View key={p.name} style={styles.topProductRow}>
                  <View style={styles.rankBadge}>
                    <Text style={styles.rankBadgeText}>#{idx + 1}</Text>
                  </View>
                  <View style={styles.topProductInfo}>
                    <Text style={styles.topProductName} numberOfLines={1}>{p.name}</Text>
                    <Text style={styles.topProductUnits}>{p.quantity} units sold</Text>
                  </View>
                  <Text style={styles.topProductRev}>
                    {currencySymbol} {p.revenue.toFixed(2)}
                  </Text>
                </View>
              ))}
            </View>
          </SectionCard>
        ) : null}

        {/* Live Recent Transactions Feed */}
        {recentTransactions.length > 0 ? (
          <SectionCard>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleWithIcon}>
                <Ionicons name="receipt-outline" size={18} color={Colors.primaryBlue} />
                <Text style={styles.sectionTitle}>Recent Transactions</Text>
              </View>
              <Pressable onPress={() => router.push("/orders")}>
                <Text style={styles.seeAllLink}>All Orders</Text>
              </Pressable>
            </View>

            <View style={styles.recentList}>
              {recentTransactions.map((tx) => {
                const isPartPaid = tx.amountPaid < tx.total;
                return (
                  <Pressable
                    key={tx.id}
                    style={({ pressed }) => [styles.txRow, pressed && styles.txRowPressed]}
                    onPress={() => router.push(`/pos/receipt/${tx.id}`)}
                  >
                    <View style={styles.txIconWrap}>
                      <Ionicons
                        name={isPartPaid ? "time-outline" : "checkmark-circle"}
                        size={20}
                        color={isPartPaid ? Colors.accentOrange : Colors.success}
                      />
                    </View>
                    <View style={styles.txDetails}>
                      <Text style={styles.txOrderNum}>#{tx.orderNumber}</Text>
                      <Text style={styles.txCustName}>
                        {tx.customerName || "Walk-in Customer"}
                      </Text>
                    </View>
                    <View style={styles.txAmountWrap}>
                      <Text style={styles.txTotal}>
                        {currencySymbol} {tx.total.toFixed(2)}
                      </Text>
                      <Text style={[styles.txStatus, isPartPaid ? styles.txStatusPart : styles.txStatusPaid]}>
                        {isPartPaid ? "Partial / Credit" : "Paid"}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
                  </Pressable>
                );
              })}
            </View>
          </SectionCard>
        ) : null}

        {/* Quick Actions Hub */}
        <SectionCard>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleWithIcon}>
              <Ionicons name="apps" size={18} color={Colors.primaryBlue} />
              <Text style={styles.sectionTitle}>Management Hub</Text>
            </View>
            <Text style={styles.sectionHeaderBadge}>6 tools</Text>
          </View>
          <View style={styles.shortcutGrid}>
            {SHORTCUTS.map((s) => (
              <Pressable
                key={s.label}
                style={({ pressed }) => [
                  styles.shortcutCard,
                  pressed && styles.shortcutCardPressed,
                ]}
                onPress={() => router.push(s.href)}
                accessibilityRole="button"
              >
                <View style={[styles.shortcutIconWrap, { backgroundColor: s.bg }]}>
                  <Ionicons name={s.icon} size={20} color={s.color} />
                </View>
                <View style={styles.shortcutTextWrap}>
                  <Text style={styles.shortcutTitle}>{s.label}</Text>
                  <Text style={styles.shortcutSubtitle} numberOfLines={1}>
                    {s.subtitle}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
              </Pressable>
            ))}
          </View>
        </SectionCard>
      </AppScrollScreen>

      {/* Slide-out Store Drawer */}
      <Modal
        visible={drawerOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setDrawerOpen(false)}
      >
        <View style={styles.drawerBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setDrawerOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close drawer"
          />
          <View style={styles.drawerCard}>
            <View style={styles.drawerHeaderRow}>
              <Text style={styles.drawerHeaderTitle}>Store Profile</Text>
              <Pressable
                style={({ pressed }) => [styles.drawerCloseBtn, pressed && { opacity: 0.7 }]}
                onPress={() => setDrawerOpen(false)}
                hitSlop={10}
              >
                <Ionicons name="close" size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Spacing.xl }}>
              {/* Store Avatar & Info Card */}
              <View style={styles.drawerProfileHero}>
                <Pressable onPress={() => void changeLogo()} style={styles.avatarPickerWrap}>
                  <Avatar uri={shopLogoUri} fallbackInitials={shopName} size={64} />
                  <View style={styles.avatarCameraBadge}>
                    <Ionicons name="camera" size={13} color={Colors.white} />
                  </View>
                </Pressable>
                <Text style={styles.drawerShopName}>{shopName}</Text>
                <Text style={styles.drawerShopEmail}>{shopEmail || "contact@omnipos.store"}</Text>
                <View style={styles.storeStatusBadge}>
                  <View style={styles.statusDot} />
                  <Text style={styles.storeStatusText}>Active Store</Text>
                </View>
              </View>

              {/* Quick Settings Section */}
              <View style={styles.drawerSection}>
                <Text style={styles.drawerSectionTitle}>CURRENCY & LOCALE</Text>
                <View style={styles.pickerRow}>
                  {CURRENCIES.map((c) => {
                    const selected = currency === c;
                    return (
                      <Pressable
                        key={c}
                        style={[styles.chipButton, selected && styles.chipButtonSelected]}
                        onPress={() => setCurrency(c)}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {c}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={[styles.pickerRow, { marginTop: Spacing.sm }]}>
                  {LANGUAGES.map((l) => {
                    const selected = language === l;
                    return (
                      <Pressable
                        key={l}
                        style={[styles.chipButton, selected && styles.chipButtonSelected]}
                        onPress={() => setLanguage(l)}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {l}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.drawerSection}>
                <Text style={styles.drawerSectionTitle}>PREFERENCES</Text>
                <View style={styles.switchRow}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Ionicons name="moon-outline" size={20} color={Colors.textPrimary} />
                    <Text style={styles.switchLabel}>Dark Mode (Beta)</Text>
                  </View>
                  <Switch
                    value={appModeDark}
                    onValueChange={setAppModeDark}
                    trackColor={{ false: "#e2e8f0", true: Colors.primaryBlueLight }}
                    thumbColor={appModeDark ? Colors.primaryBlue : "#cbd5e1"}
                  />
                </View>
              </View>

              {/* Navigation Links */}
              <View style={styles.drawerSection}>
                <Text style={styles.drawerSectionTitle}>QUICK NAVIGATION</Text>
                <Pressable
                  style={styles.drawerNavLink}
                  onPress={() => {
                    setDrawerOpen(false);
                    router.push("/inventory");
                  }}
                >
                  <Ionicons name="cube-outline" size={18} color={Colors.primaryBlue} />
                  <Text style={styles.drawerNavLinkText}>Inventory Catalog</Text>
                  <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
                </Pressable>
                <Pressable
                  style={styles.drawerNavLink}
                  onPress={() => {
                    setDrawerOpen(false);
                    router.push("/customers");
                  }}
                >
                  <Ionicons name="people-outline" size={18} color={Colors.primaryBlue} />
                  <Text style={styles.drawerNavLinkText}>Customers CRM</Text>
                  <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
                </Pressable>
                <Pressable
                  style={styles.drawerNavLink}
                  onPress={() => {
                    setDrawerOpen(false);
                    router.push("/analytics");
                  }}
                >
                  <Ionicons name="trending-up-outline" size={18} color={Colors.primaryBlue} />
                  <Text style={styles.drawerNavLinkText}>Detailed Analytics</Text>
                  <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
                </Pressable>
                <Pressable
                  style={styles.drawerNavLink}
                  onPress={() => {
                    setDrawerOpen(false);
                    router.push("/settings");
                  }}
                >
                  <Ionicons name="settings-outline" size={18} color={Colors.primaryBlue} />
                  <Text style={styles.drawerNavLinkText}>Store Settings</Text>
                  <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
                </Pressable>
              </View>

              {/* Switch Store & Sign Out */}
              <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
                <PrimaryButton
                  label="Switch Store"
                  variant="outline"
                  onPress={() => {
                    setDrawerOpen(false);
                    router.push("/onboarding/store");
                  }}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  shopAvatarBtn: {
    padding: 2,
  },
  syncPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryBluePale,
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  syncPillPending: {
    backgroundColor: "#eff6ff",
    borderColor: Colors.primaryBlue,
  },
  syncPillError: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
  },
  syncPillInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  syncLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  syncLabelError: {
    color: Colors.danger,
  },
  heroCard: {
    backgroundColor: Colors.surface,
    borderColor: "#e2e8f0",
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  liveTagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 4,
  },
  liveIndicatorDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  liveTagText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: Colors.success,
  },
  heroTitle: {
    ...Typography.headline,
    fontSize: 20,
    fontWeight: "900",
    color: Colors.textPrimary,
  },
  heroSub: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  newSaleHeroBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.primaryBlue,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  newSaleHeroText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: "800",
  },
  syncError: {
    ...Typography.caption,
    color: Colors.danger,
    marginTop: Spacing.xs,
  },
  expiryAlertCard: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
    borderWidth: 1,
    padding: Spacing.sm,
  },
  expiryAlertTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#dc2626",
  },
  expiryAlertSub: {
    fontSize: 12,
    color: "#b91c1c",
    marginTop: 2,
  },
  lowStockCard: {
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
    borderWidth: 1,
    padding: Spacing.sm,
  },
  lowStockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  lowStockTextWrap: {
    flex: 1,
  },
  lowStockTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#d97706",
  },
  lowStockSub: {
    fontSize: 12,
    color: "#b45309",
    marginTop: 2,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  kpiGridCell: {
    width: "48%",
    flexGrow: 1,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  sectionTitleWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionTitle: {
    ...Typography.title,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  sectionHeaderBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primaryBlue,
    backgroundColor: Colors.primaryBluePale,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  seeAllLink: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  topProductsList: {
    gap: Spacing.xs,
  },
  topProductRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    padding: Spacing.sm,
    borderRadius: Radius.input,
    gap: Spacing.sm,
  },
  rankBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
  },
  rankBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
  topProductInfo: {
    flex: 1,
  },
  topProductName: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  topProductUnits: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  topProductRev: {
    fontSize: 13,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  recentList: {
    gap: Spacing.xs,
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    padding: Spacing.sm,
    borderRadius: Radius.input,
    gap: Spacing.sm,
  },
  txRowPressed: {
    opacity: 0.8,
  },
  txIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  txDetails: {
    flex: 1,
  },
  txOrderNum: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  txCustName: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  txAmountWrap: {
    alignItems: "flex-end",
    gap: 2,
  },
  txTotal: {
    fontSize: 13,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  txStatus: {
    fontSize: 10,
    fontWeight: "700",
  },
  txStatusPaid: {
    color: Colors.success,
  },
  txStatusPart: {
    color: Colors.accentOrange,
  },
  shortcutGrid: {
    gap: Spacing.xs,
  },
  shortcutCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    gap: Spacing.sm,
  },
  shortcutCardPressed: {
    backgroundColor: "#f1f5f9",
  },
  shortcutIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  shortcutTextWrap: {
    flex: 1,
  },
  shortcutTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  shortcutSubtitle: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  drawerCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    maxHeight: "85%",
  },
  drawerHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  drawerHeaderTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  drawerCloseBtn: {
    padding: 6,
  },
  drawerProfileHero: {
    alignItems: "center",
    paddingVertical: Spacing.md,
    backgroundColor: Colors.background,
    borderRadius: Radius.card,
    marginBottom: Spacing.md,
    gap: 4,
  },
  avatarPickerWrap: {
    position: "relative",
    marginBottom: 4,
  },
  avatarCameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: Colors.primaryBlue,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.white,
  },
  drawerShopName: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  drawerShopEmail: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  storeStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#eff6ff",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    marginTop: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.success,
  },
  storeStatusText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  drawerSection: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  drawerSectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: Colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  pickerRow: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  chipButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipButtonSelected: {
    backgroundColor: Colors.primaryBlue,
    borderColor: Colors.primaryBlue,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  chipTextSelected: {
    color: Colors.white,
    fontWeight: "700",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.background,
    padding: Spacing.sm,
    borderRadius: Radius.input,
  },
  switchLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  drawerNavLink: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    padding: Spacing.sm,
    borderRadius: Radius.input,
    gap: Spacing.sm,
  },
  drawerNavLinkText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
});
