import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { KPICard } from "@/src/components/molecules/KPICard";
import { SalesLineChart } from "@/src/components/organisms/SalesLineChart";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import {
  MOCK_KPIS,
  MOCK_SALES_CHART,
  MOCK_STORE_NAME,
} from "@/src/lib/uiMock";
import { useStoreSlice } from "@/src/store/storeSlice";

const SHORTCUTS: {
  label: string;
  href: "/inventory" | "/product/add" | "/pos/add-order" | "/analytics" | "/returns";
}[] = [
  { label: "Inventory", href: "/inventory" },
  { label: "Add product", href: "/product/add" },
  { label: "New order", href: "/pos/add-order" },
  { label: "Returns", href: "/returns" },
  { label: "Analytics", href: "/analytics" },
];

export default function HomeScreen() {
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const router = useRouter();

  if (!activeStoreId) {
    return <Redirect href="/onboarding/store" />;
  }

  return (
    <AppScrollScreen
      title={MOCK_STORE_NAME}
      subtitle="Dashboard preview — static data only."
      right={
        <Pressable style={styles.syncPill} onPress={() => {}} accessibilityRole="button">
          <Text style={styles.syncLabel}>Sync</Text>
        </Pressable>
      }
    >
      <Text style={styles.hint}>Pending sync: 3 · Last sync: 2h ago</Text>

      <View style={styles.kpiRow}>
        {MOCK_KPIS.map((k) => (
          <View key={k.title} style={styles.kpiCell}>
            <KPICard title={k.title} value={k.value} period={k.period} variant={k.variant} />
          </View>
        ))}
      </View>

      <SectionCard>
        <Text style={styles.sectionTitle}>Sales trend</Text>
        <SalesLineChart data={MOCK_SALES_CHART} period="Last 7 days (mock)" />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Shortcuts</Text>
        <View style={styles.shortcutGrid}>
          {SHORTCUTS.map((s) => (
            <View key={s.label} style={styles.shortcutCell}>
              <PrimaryButton
                label={s.label}
                variant="outline"
                fullWidth
                onPress={() => router.push(s.href)}
              />
            </View>
          ))}
        </View>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Receipts</Text>
        <Text style={styles.caption}>Open a sample receipt layout.</Text>
        <PrimaryButton
          label="View sample receipt"
          variant="primary"
          fullWidth
          onPress={() => router.push("/pos/receipt/demo")}
        />
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  hint: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: -Spacing.xs,
  },
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
  },
  caption: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  shortcutGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  shortcutCell: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 140,
  },
  syncPill: {
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  syncLabel: {
    color: Colors.primaryBlue,
    fontWeight: "700",
    fontSize: 13,
  },
});
