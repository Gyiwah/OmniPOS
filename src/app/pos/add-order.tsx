import { StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { OrderItemsList } from "@/src/components/organisms/OrderItemsList";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { MOCK_ORDER_LINES } from "@/src/lib/uiMock";

export default function AddOrderScreen() {
  return (
    <AppScrollScreen showBack title="New order" subtitle="Cart preview (read-only mock lines).">
      <SectionCard>
        <TextInput label="Customer" placeholder="Walk-in or name" />
        <TextInput label="Scan / search" placeholder="Add SKU or barcode" editable={false} />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Line items</Text>
        <OrderItemsList
          items={MOCK_ORDER_LINES}
          readOnly
          totalLabel="₵ 55.50"
          onUpdateQty={() => {}}
        />
      </SectionCard>

      <PrimaryButton label="Hold order" variant="outline" onPress={() => {}} />
      <PrimaryButton label="Charge customer" onPress={() => {}} />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
});
