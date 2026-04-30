import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { OrderItemsList } from "@/src/components/organisms/OrderItemsList";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { MOCK_ORDER_LINES } from "@/src/lib/uiMock";

export default function OrderInfoScreen() {
  const router = useRouter();

  return (
    <AppScrollScreen showBack title="Order ORD-1042" subtitle="Paid · Counter pickup">
      <View style={styles.statusRow}>
        <Text style={styles.pill}>Completed</Text>
      </View>

      <SectionCard>
        <Text style={styles.meta}>Customer · Ama Mensah</Text>
        <Text style={styles.meta}>Opened · Today 2:14 PM</Text>
        <Text style={styles.meta}>Cashier · You</Text>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Items</Text>
        <OrderItemsList
          items={MOCK_ORDER_LINES}
          readOnly
          totalLabel="₵ 55.50"
          onUpdateQty={() => {}}
        />
      </SectionCard>

      <PrimaryButton label="Print receipt" onPress={() => router.push("/pos/receipt/demo")} />
      <PrimaryButton label="Refund (start return)" variant="outline" onPress={() => router.push("/pos/add-return")} />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  pill: {
    ...Typography.caption,
    fontWeight: "700",
    color: Colors.success,
    backgroundColor: "#dcfce7",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: "hidden",
  },
  meta: {
    ...Typography.body,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
});
