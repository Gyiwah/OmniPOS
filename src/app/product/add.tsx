import { StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { Colors } from "@/src/constants/colors";

export default function AddProductScreen() {
  return (
    <AppScrollScreen showBack title="Add product" subtitle="Create a catalog item (static form).">
      <SectionCard>
        <Text style={styles.sectionTitle}>Basics</Text>
        <TextInput label="Name" placeholder="e.g. Filtered water 500ml" />
        <TextInput label="SKU" placeholder="SKU-10241" />
        <TextInput label="Barcode" placeholder="Optional" />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Pricing & stock</Text>
        <TextInput label="Sell price" placeholder="0.00" keyboardType="decimal-pad" />
        <TextInput label="Cost price" placeholder="Optional" keyboardType="decimal-pad" />
        <TextInput label="Opening stock" placeholder="0" keyboardType="number-pad" />
      </SectionCard>

      <PrimaryButton label="Save product" onPress={() => {}} />
      <PrimaryButton label="Save & add another" variant="outline" onPress={() => {}} />
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
