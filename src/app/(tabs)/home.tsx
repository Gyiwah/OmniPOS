import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Switch, Text, View } from "react-native";

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
import { formatRelativeSyncTime } from "@/src/utils/date";

const SHORTCUTS: {
  label: string;
  href: "/inventory" | "/product/add" | "/pos/add-order" | "/analytics" | "/returns" | "/customers";
}[] = [
  { label: "Inventory", href: "/inventory" },
  { label: "Add product", href: "/product/add" },
  { label: "Create order", href: "/pos/add-order" },
  { label: "Customers", href: "/customers" },
  { label: "Returns", href: "/returns" },
  { label: "Analytics", href: "/analytics" },
];

const LANGUAGES = ["English", "French", "Spanish"] as const;
const CURRENCIES = ["GHS", "USD", "NGN"] as const;

export default function HomeScreen() {
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [kpis, setKpis] = useState([
    { title: "Net sales", value: "₵ 0.00", period: "Last 7 days", variant: "primary" as const },
    { title: "Orders", value: "0", period: "Last 7 days", variant: "accent" as const },
    { title: "Avg. ticket", value: "₵ 0.00", period: "Per completed sale", variant: "success" as const },
  ]);
  const [salesChart, setSalesChart] = useState<{ label: string; value: number }[]>([]);
  const [barWeek, setBarWeek] = useState<{ label: string; sales: number; returns: number }[]>([]);
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

  useEffect(() => {
    let mounted = true;
    async function loadDashboard() {
      if (!activeStoreId) return;

      // Low stock check from WatermelonDB SQLite
      try {
        const { database } = await import("@/src/database");
        const { Q } = await import("@ Nozbe/watermelondb" as any).catch(() => ({ Q: null }));
        const ProductModel = (await import("@/src/database/models/Product")).default;
        const allProducts = await database.get<Product>("products").query().fetch();
        const lowStockItems = allProducts.filter(
          (p) => p.storeId === activeStoreId && Number(p.stock ?? 0) <= Number(p.reorderLevel ?? 5),
        );
        if (mounted) setLowStockCount(lowStockItems.length);
      } catch {
        // ignore
      }

      const since = new Date();
      since.setDate(since.getDate() - 6);

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

      const orderRows = orders ?? [];
      const returnRows = returns ?? [];
      const orderTotal = orderRows.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
      const returnTotal = returnRows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
      const netSales = Math.max(0, orderTotal - returnTotal);
      const avgTicket = orderRows.length ? orderTotal / orderRows.length : 0;

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

      if (!mounted) return;
      setKpis([
        { title: "Net sales", value: `${currencySymbol} ${netSales.toFixed(2)}`, period: "Last 7 days", variant: "primary" },
        { title: "Orders", value: String(orderRows.length), period: "Last 7 days", variant: "accent" },
        { title: "Avg. ticket", value: `${currencySymbol} ${avgTicket.toFixed(2)}`, period: "Per completed sale", variant: "success" },
      ]);
      setSalesChart(line);
      setBarWeek(bar);
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
        subtitle={`Professional POS dashboard · ${currency} mode`}
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
        <SectionCard>
          <Text style={styles.kicker}>Today</Text>
          <Text style={styles.heroTitle}>Welcome back, {shopName}</Text>
          <Text style={styles.heroSub}>{heroSub}</Text>
          {syncStatus === "error" && lastError ? (
            <Text style={styles.syncError}>{lastError}</Text>
          ) : null}
        </SectionCard>

        {lowStockCount > 0 ? (
          <Pressable onPress={() => router.push("/inventory")}>
            <SectionCard style={styles.lowStockCard}>
              <View style={styles.lowStockRow}>
                <Ionicons name="warning-outline" size={22} color="#d97706" />
                <View style={styles.lowStockTextWrap}>
                  <Text style={styles.lowStockTitle}>Low Stock Warning</Text>
                  <Text style={styles.lowStockSub}>
                    {lowStockCount} product{lowStockCount > 1 ? "s are" : " is"} at or below reorder level.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </View>
            </SectionCard>
          </Pressable>
        ) : null}

        <View style={styles.kpiRow}>
          {kpis.map((k) => (
            <View key={k.title} style={styles.kpiCell}>
              <KPICard
                title={k.title}
                value={k.value}
                period={k.period}
                variant={k.variant}
              />
            </View>
          ))}
        </View>

        <SectionCard>
          <Text style={styles.sectionTitle}>Sales trend</Text>
          <SalesLineChart data={salesChart} period="Last 7 days" />
        </SectionCard>

        <SectionCard>
          <Text style={styles.sectionTitle}>Orders vs Returns</Text>
          <OrdersBarChart data={barWeek} period="This week" />
        </SectionCard>

        <SectionCard>
          <Text style={styles.sectionTitle}>Quick actions</Text>
          <View style={styles.shortcutGrid}>
            {SHORTCUTS.map((s) => (
              <View key={s.label} style={styles.shortcutCell}>
                <PrimaryButton label={s.label} variant="outline" fullWidth onPress={() => router.push(s.href)} />
              </View>
            ))}
          </View>
        </SectionCard>
      </AppScrollScreen>

      <Modal visible={drawerOpen} transparent animationType="slide" onRequestClose={() => setDrawerOpen(false)}>
        <View style={styles.drawerOverlay}>
          <Pressable style={styles.backdrop} onPress={() => setDrawerOpen(false)} />
          <View style={styles.drawerPanel}>
            <View style={styles.drawerHeader}>
              <Pressable onPress={() => void changeLogo()}>
                <Avatar uri={shopLogoUri} fallbackInitials={shopName} size={92} />
              </Pressable>
              <Text style={styles.shopName}>{shopName}</Text>
              <Text style={styles.shopEmail}>{shopEmail}</Text>
              <PrimaryButton
                label="Edit shop profile"
                variant="outline"
                fullWidth={false}
                style={styles.profileBtn}
                onPress={() => router.push("/settings")}
              />
            </View>

            <View style={styles.menuList}>
              <Pressable style={styles.menuRow} onPress={() => router.push("/settings")}>
                <View style={styles.menuLeft}>
                  <Ionicons name="settings-outline" size={20} color={Colors.textSecondary} />
                  <Text style={styles.menuText}>Settings</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </Pressable>

              <Pressable
                style={styles.menuRow}
                onPress={() => {
                  const current = LANGUAGES.indexOf(language as (typeof LANGUAGES)[number]);
                  const next = LANGUAGES[(current + 1) % LANGUAGES.length];
                  setLanguage(next);
                }}
              >
                <View style={styles.menuLeft}>
                  <Ionicons name="language-outline" size={20} color={Colors.textSecondary} />
                  <Text style={styles.menuText}>Select Language</Text>
                </View>
                <Text style={styles.menuValue}>{language}</Text>
              </Pressable>

              <Pressable
                style={styles.menuRow}
                onPress={() => {
                  const current = CURRENCIES.indexOf(currency as (typeof CURRENCIES)[number]);
                  const next = CURRENCIES[(current + 1) % CURRENCIES.length];
                  setCurrency(next);
                }}
              >
                <View style={styles.menuLeft}>
                  <Ionicons name="cash-outline" size={20} color={Colors.textSecondary} />
                  <Text style={styles.menuText}>Currency Settings</Text>
                </View>
                <Text style={styles.menuValue}>{currency}</Text>
              </Pressable>
            </View>

            <View style={styles.modeRow}>
              <Text style={styles.modeLabel}>App Mode</Text>
              <Switch value={appModeDark} onValueChange={setAppModeDark} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  shopAvatarBtn: { marginTop: 2 },
  kicker: {
    ...Typography.caption,
    color: Colors.primaryBlue,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  heroTitle: {
    ...Typography.headline,
    color: Colors.textPrimary,
  },
  heroSub: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
  syncError: {
    ...Typography.caption,
    color: Colors.accentOrange,
    marginTop: Spacing.xs,
  },
  lowStockCard: {
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
    borderWidth: 1,
  },
  lowStockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  lowStockTextWrap: { flex: 1 },
  lowStockTitle: { fontSize: 15, fontWeight: "700", color: "#92400e" },
  lowStockSub: { fontSize: 13, color: "#b45309" },
  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  kpiCell: { flexGrow: 1, flexBasis: "30%", minWidth: 100 },
  sectionTitle: { ...Typography.title, color: Colors.textPrimary },
  shortcutGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  shortcutCell: { flexGrow: 1, flexBasis: "45%", minWidth: 140 },
  syncPill: {
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.primaryBluePale,
  },
  syncPillPending: {
    borderColor: Colors.primaryBlue,
  },
  syncPillError: {
    backgroundColor: Colors.accentOrangePale,
    borderColor: Colors.accentOrange,
  },
  syncPillInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  syncLabel: { color: Colors.primaryBlue, fontWeight: "700", fontSize: 13 },
  syncLabelError: { color: Colors.accentOrange },
  drawerOverlay: { flex: 1, flexDirection: "row", backgroundColor: "rgba(0,0,0,0.3)" },
  backdrop: { flex: 1 },
  drawerPanel: {
    width: "80%",
    backgroundColor: Colors.surface,
    paddingTop: 48,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.lg,
    justifyContent: "space-between",
  },
  drawerHeader: {
    alignItems: "center",
    gap: Spacing.xs,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.divider,
  },
  shopName: { ...Typography.title, color: Colors.textPrimary },
  shopEmail: { ...Typography.body, color: Colors.textSecondary },
  profileBtn: { minWidth: 150, marginTop: Spacing.xs },
  menuList: { marginTop: Spacing.md, gap: Spacing.sm },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.divider,
  },
  menuLeft: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  menuText: { ...Typography.body, color: Colors.textSecondary, fontWeight: "600" },
  menuValue: { ...Typography.caption, color: Colors.primaryBlue, fontWeight: "700" },
  modeRow: {
    marginTop: Spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
  },
  modeLabel: { ...Typography.title, color: Colors.textSecondary },
});
