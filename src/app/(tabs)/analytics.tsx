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
import {
  MOCK_BAR_WEEK,
  MOCK_BEST_SELLERS,
  MOCK_KPIS,
  MOCK_SALES_CHART,
} from "@/src/lib/uiMock";

export default function AnalyticsScreen() {
  return (
    <AppScrollScreen title="Analytics" subtitle="Performance snapshot (static).">
      <View style={styles.kpiRow}>
        {MOCK_KPIS.map((k) => (
          <View key={k.title} style={styles.kpiCell}>
            <KPICard title={k.title} value={k.value} period={k.period} variant={k.variant} />
          </View>
        ))}
      </View>

      <SectionCard>
        <Text style={styles.sectionTitle}>Revenue</Text>
        <SalesLineChart data={MOCK_SALES_CHART} period="Trailing 7 days" />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Orders vs returns</Text>
        <OrdersBarChart data={MOCK_BAR_WEEK} period="This week" />
      </SectionCard>

      <AnalyticsCard title="Category mix" period="Last 30 days" averageLabel={<Text style={styles.k}>Avg</Text>}>
        <Text style={styles.body}>Grocery 42% · Beverages 28% · Household 18% · Other 12%</Text>
      </AnalyticsCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Best sellers</Text>
        <View style={styles.list}>
          {MOCK_BEST_SELLERS.map((b) => (
            <BestSellerRow
              key={`seller-${b.rank}`}
              rank={b.rank}
              imageUrl={b.imageUrl}
              name={b.name}
              unitsSold={b.unitsSold}
            />
          ))}
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
