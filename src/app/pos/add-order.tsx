import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { OrderItemsList } from "@/src/components/organisms/OrderItemsList";
import { BarcodeScanner } from "@/src/components/organisms/BarcodeScanner";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { MOCK_ORDER_LINES } from "@/src/lib/uiMock";

export default function AddOrderScreen() {
  const [customer, setCustomer] = useState("");
  const [search, setSearch] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [payMethod, setPayMethod] = useState<"cash" | "momo" | "card">("cash");
  const [lines, setLines] = useState(MOCK_ORDER_LINES);

  const totalLabel = useMemo(() => {
    const total = lines.reduce((sum, row) => {
      const amount = Number(row.unitPriceLabel.replace(/[^\d.]/g, "")) || 0;
      return sum + amount * row.quantity;
    }, 0);
    return `₵ ${total.toFixed(2)}`;
  }, [lines]);

  function updateLineQty(productId: string, quantity: number) {
    setLines((prev) => prev.map((row) => (row.id === productId ? { ...row, quantity } : row)));
  }

  return (
    <AppScrollScreen showBack title="Add Order" subtitle="Build cart and checkout.">
      <SectionCard>
        <TextInput label="Customer" value={customer} onChangeText={setCustomer} placeholder="Walk-in or name" />
        <TextInput
          label="Scan / search"
          value={search}
          onChangeText={setSearch}
          placeholder="Add SKU or barcode"
          rightIcon={
            <Pressable onPress={() => setShowScanner((v) => !v)} hitSlop={10}>
              <Ionicons
                name={showScanner ? "close-circle-outline" : "scan-outline"}
                size={22}
                color={Colors.primaryBlue}
              />
            </Pressable>
          }
        />
        {showScanner ? (
          <BarcodeScanner
            label="Align product barcode to search/add"
            onScan={(payload) => {
              setSearch(payload);
              setShowScanner(false);
            }}
          />
        ) : null}
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Payment</Text>
        <View style={styles.pillRow}>
          <Pressable
            onPress={() => setPayMethod("cash")}
            style={[styles.pill, payMethod === "cash" && styles.pillActive]}
          >
            <Text style={[styles.pillText, payMethod === "cash" && styles.pillTextActive]}>Cash</Text>
          </Pressable>
          <Pressable
            onPress={() => setPayMethod("momo")}
            style={[styles.pill, payMethod === "momo" && styles.pillActive]}
          >
            <Text style={[styles.pillText, payMethod === "momo" && styles.pillTextActive]}>MoMo</Text>
          </Pressable>
          <Pressable
            onPress={() => setPayMethod("card")}
            style={[styles.pill, payMethod === "card" && styles.pillActive]}
          >
            <Text style={[styles.pillText, payMethod === "card" && styles.pillTextActive]}>Card</Text>
          </Pressable>
        </View>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Line items</Text>
        <OrderItemsList
          items={lines}
          totalLabel={totalLabel}
          onUpdateQty={updateLineQty}
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
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  pill: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  pillActive: {
    borderColor: Colors.primaryBlue,
    backgroundColor: Colors.primaryBluePale,
  },
  pillText: {
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  pillTextActive: {
    color: Colors.primaryBlue,
  },
});
