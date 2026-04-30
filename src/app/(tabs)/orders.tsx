import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { OrderCard } from "@/src/components/molecules/OrderCard";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { Colors } from "@/src/constants/colors";
import { MOCK_ORDERS } from "@/src/lib/uiMock";

export default function OrdersScreen() {
  const router = useRouter();

  return (
    <AppScrollScreen title="Orders" subtitle="Recent activity (static).">
      <PrimaryButton label="New order" onPress={() => router.push("/pos/add-order")} />

      <SectionCard>
        <Text style={styles.sectionTitle}>Open & recent</Text>
        <View style={styles.list}>
          {MOCK_ORDERS.map((o) => (
            <OrderCard
              key={o.id}
              thumbnails={o.thumbnails}
              customerName={o.customerName}
              dateLabel={o.dateLabel}
              itemCount={o.itemCount}
              totalLabel={o.totalLabel}
              isPartPayment={o.isPartPayment}
              onPress={() => router.push("/pos/order-info")}
            />
          ))}
        </View>
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  list: {
    gap: Spacing.sm,
  },
});
