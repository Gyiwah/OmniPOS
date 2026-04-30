import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { ProductCard } from "@/src/components/molecules/ProductCard";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { MOCK_PRODUCTS } from "@/src/lib/uiMock";

export default function InventoryScreen() {
  const router = useRouter();

  return (
    <AppScrollScreen title="Inventory" subtitle="Stock overview (static).">
      <SectionCard>
        <TextInput
          label="Search"
          placeholder="SKU, name, or barcode"
          leftIcon={<Ionicons name="search" size={20} color={Colors.textMuted} />}
          editable={false}
        />
      </SectionCard>

      <SectionCard>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Products</Text>
          <PrimaryButton
            label="Add"
            variant="outline"
            fullWidth={false}
            style={styles.addBtn}
            onPress={() => router.push("/product/add")}
          />
        </View>
        <View style={styles.list}>
          {MOCK_PRODUCTS.map((p) => (
            <ProductCard
              key={p.id}
              name={p.name}
              stockCount={p.stockCount}
              lowStockThreshold={p.lowStockThreshold}
              onPress={() => {}}
            />
          ))}
        </View>
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    flex: 1,
  },
  addBtn: {
    alignSelf: "flex-start",
    minWidth: 88,
  },
  list: {
    gap: Spacing.sm,
  },
});
