import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { useOrderDraftStore } from "@/src/store/orderDraftStore";
import { useSettingsStore } from "@/src/store/settingsStore";

function symbolFor(currency: string) {
  if (currency === "USD") return "$";
  if (currency === "NGN") return "₦";
  return "₵";
}

export default function OrderInfoScreen() {
  const router = useRouter();
  const { lines, discountMode, discountValue, amountPaid, customerName, customerPhone, shippingAddress, setDiscountMode, setDiscountValue, setAmountPaid, setCustomer } =
    useOrderDraftStore();
  const { currency, taxRate, vatRate, serviceRate } = useSettingsStore();
  const [customerOpen, setCustomerOpen] = useState(true);

  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + line.price * line.quantity, 0), [lines]);
  const discountAmount = useMemo(
    () => (discountMode === "percentage" ? subtotal * (discountValue / 100) : discountValue),
    [discountMode, discountValue, subtotal],
  );
  const taxedBase = Math.max(0, subtotal - discountAmount);
  const tax = taxedBase * (taxRate / 100);
  const vat = taxedBase * (vatRate / 100);
  const service = taxedBase * (serviceRate / 100);
  const total = taxedBase + tax + vat + service;
  const change = Math.max(0, amountPaid - total);
  const sym = symbolFor(currency);

  return (
    <AppScrollScreen showBack title="Order info" subtitle="Apply discounts, charges, and capture optional customer details.">
      <SectionCard>
        <Text style={styles.totalLabel}>Total price</Text>
        <Text style={styles.totalValue}>
          {sym} {total.toFixed(2)}
        </Text>
      </SectionCard>

      <SectionCard>
        <View style={styles.discountRow}>
          <Text style={styles.discountLabel}>Discount</Text>
          <TextInput
            value={discountValue ? String(discountValue) : ""}
            onChangeText={(v) => setDiscountValue(Number(v) || 0)}
            placeholder="Enter"
            keyboardType="decimal-pad"
            containerStyle={styles.discountInput}
          />
          <Pressable
            style={styles.modePill}
            onPress={() => setDiscountMode(discountMode === "percentage" ? "amount" : "percentage")}
          >
            <Text style={styles.modeText}>{discountMode === "percentage" ? "Percentage" : "Amount"}</Text>
            <Ionicons name="chevron-down" size={16} color={Colors.primaryBlue} />
          </Pressable>
        </View>
        <View style={styles.amountRow}>
          <Text style={styles.amountLabel}>Amount</Text>
          <TextInput
            value={amountPaid ? String(amountPaid) : ""}
            onChangeText={(v) => setAmountPaid(Number(v) || 0)}
            placeholder="0"
            keyboardType="decimal-pad"
            containerStyle={styles.amountInput}
          />
        </View>
        <View style={styles.changeBox}>
          <Text style={styles.changeLabel}>Change</Text>
          <Text style={styles.changeVal}>
            {sym} {change.toFixed(2)}
          </Text>
        </View>
        <Text style={styles.breakdown}>
          Subtotal {sym}
          {subtotal.toFixed(2)} · Tax {taxRate}% {sym}
          {tax.toFixed(2)} · VAT {vatRate}% {sym}
          {vat.toFixed(2)} · Service {serviceRate}% {sym}
          {service.toFixed(2)}
        </Text>
      </SectionCard>

      <SectionCard>
        <Pressable style={styles.customerHeader} onPress={() => setCustomerOpen((v) => !v)}>
          <Text style={styles.customerTitle}>Customer Info</Text>
          <Ionicons name={customerOpen ? "chevron-up" : "chevron-down"} size={20} color={Colors.primaryBlue} />
        </Pressable>
        {customerOpen ? (
          <View style={styles.customerInputs}>
            <TextInput
              value={customerName}
              onChangeText={(name) => setCustomer({ name })}
              placeholder="Optional"
              leftIcon={<Ionicons name="person-outline" size={18} color={Colors.textMuted} />}
            />
            <TextInput
              value={customerPhone}
              onChangeText={(phone) => setCustomer({ phone })}
              placeholder="0240000000"
              keyboardType="phone-pad"
              leftIcon={<Ionicons name="call-outline" size={18} color={Colors.textMuted} />}
            />
            <TextInput
              value={shippingAddress}
              onChangeText={(value) => setCustomer({ shippingAddress: value })}
              placeholder="Optional"
              leftIcon={<Ionicons name="car-outline" size={18} color={Colors.textMuted} />}
            />
          </View>
        ) : null}
      </SectionCard>

      <PrimaryButton label="Create Receipt" onPress={() => router.push("/pos/receipt/demo")} />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  totalLabel: { fontSize: 32, color: Colors.textPrimary, fontWeight: "600" },
  totalValue: { fontSize: 52, color: Colors.textPrimary, fontWeight: "800", marginTop: 6 },
  discountRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    alignItems: "center",
  },
  discountLabel: {
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  discountInput: { flex: 1 },
  modePill: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 11,
    backgroundColor: Colors.surface,
  },
  modeText: { color: Colors.textSecondary, fontWeight: "600" },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  amountLabel: {
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontWeight: "700",
    color: Colors.textPrimary,
    minWidth: 90,
  },
  amountInput: { flex: 1 },
  changeBox: {
    marginTop: Spacing.xs,
    borderRadius: Radius.card,
    backgroundColor: Colors.primaryBluePale,
    padding: Spacing.md,
    gap: 4,
  },
  changeLabel: { fontSize: 36, color: Colors.textPrimary, fontWeight: "600" },
  changeVal: { fontSize: 50, color: "#e05757", fontWeight: "800" },
  breakdown: {
    marginTop: Spacing.xs,
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  customerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  customerTitle: { ...Typography.title, color: Colors.textPrimary },
  customerInputs: { gap: Spacing.sm, marginTop: Spacing.xs },
});
