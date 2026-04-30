import { StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { OrderItemsList } from "@/src/components/organisms/OrderItemsList";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { MOCK_ORDER_LINES } from "@/src/lib/uiMock";

export default function AddReturnScreen() {
  return (
    <AppScrollScreen showBack title="Process return" subtitle="Match receipt or order (static).">
      <SectionCard>
        <TextInput label="Receipt / order #" placeholder="ORD-1042 or receipt code" editable={false} />
        <TextInput label="Reason" placeholder="Damaged, wrong item, …" />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Items to refund</Text>
        <OrderItemsList
          items={MOCK_ORDER_LINES}
          readOnly
          totalLabel="₵ 55.50"
          onUpdateQty={() => {}}
        />
      </SectionCard>

      <PrimaryButton label="Confirm return" onPress={() => {}} />
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
