import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { supabase } from "@/src/services/supabase";
import {
  decrementStockForOrder,
  fetchStockByProductId,
  InsufficientStockError,
  restoreStockForOrder,
  validateCartQuantities,
} from "@/src/features/orders/stock";
import { useAuthStore } from "@/src/store/authStore";
import { useOrderDraftStore } from "@/src/store/orderDraftStore";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";

import { enqueueSyncItem } from "@/src/sync/enqueue";
import { database } from "@/src/database";
import type Order from "@/src/database/models/Order";
import type OrderItem from "@/src/database/models/OrderItem";
import type { PaymentMethod } from "@/src/store/orderDraftStore";

function symbolFor(currency: string) {
  if (currency === "USD") return "$";
  if (currency === "NGN") return "₦";
  return "₵";
}

export default function OrderInfoScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const userId = useAuthStore((s) => s.userId);
  const {
    lines,
    discountMode,
    discountValue,
    amountPaid,
    paymentMethod,
    customerName,
    customerPhone,
    customerId,
    shippingAddress,
    setDiscountMode,
    setDiscountValue,
    setAmountPaid,
    setPaymentMethod,
    setCustomer,
    clearDraft,
  } = useOrderDraftStore();
  const { currency, taxRate, vatRate, serviceRate } = useSettingsStore();
  const [customerOpen, setCustomerOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);

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
  const balance = Math.max(0, total - amountPaid);
  const sym = symbolFor(currency);

  async function saveOrderOffline(orderNumber: string, cashierUserId: string) {
    if (!activeStoreId) return;
    const now = Date.now();
    let localOrderId = `local-ord-${now}`;

    await database.write(async () => {
      const ordersCol = database.get<Order>("orders");
      const orderItemsCol = database.get<OrderItem>("order_items");

      const createdOrder = await ordersCol.create((rec) => {
        rec.storeId = activeStoreId;
        rec.cashierUserId = cashierUserId;
        rec.orderNumber = orderNumber;
        rec.status = "completed";
        rec.subtotal = subtotal;
        rec.tax = tax;
        rec.discount = discountAmount;
        rec.total = total;
        rec.amountPaid = amountPaid;
        rec.changeDue = change;
        rec.paymentMethod = paymentMethod;
        rec.customerName = customerName || undefined;
        rec.customerPhone = customerPhone || undefined;
        rec.customerId = customerId || undefined;
        rec.createdAt = now;
        rec.dirty = true;
      });
      localOrderId = createdOrder.id;

      for (const line of lines) {
        await orderItemsCol.create((rec) => {
          rec.orderId = createdOrder.id;
          rec.storeId = activeStoreId;
          rec.productId = line.remoteId || line.id;
          rec.productName = line.name;
          rec.sku = line.sku;
          rec.barcode = line.barcode;
          rec.unitPrice = line.price;
          rec.quantity = line.quantity;
          rec.lineTotal = line.price * line.quantity;
        });
      }
    });

    const orderPayload = {
      id: localOrderId,
      store_id: activeStoreId,
      cashier_user_id: cashierUserId,
      order_number: orderNumber,
      status: "completed",
      subtotal,
      tax,
      discount: discountAmount,
      total,
      tax_rate: taxRate,
      vat_rate: vatRate,
      service_rate: serviceRate,
      discount_mode: discountMode,
      discount_value: discountValue,
      amount_paid: amountPaid,
      change_due: change,
      payment_method: paymentMethod,
      customer_name: customerName || null,
      customer_phone: customerPhone || null,
      customer_id: customerId || null,
      shipping_address: shippingAddress || null,
      items: lines.map((line) => ({
        product_id: line.remoteId ?? line.id,
        sku: line.sku ?? line.barcode ?? null,
        barcode: line.barcode ?? null,
        product_name: line.name,
        unit_price: line.price,
        quantity: line.quantity,
        line_total: line.price * line.quantity,
      })),
    };

    await enqueueSyncItem({
      storeId: activeStoreId,
      entity: "orders",
      operation: "upsert",
      payload: orderPayload,
      recordId: localOrderId,
    });

    clearDraft();
    Alert.alert("Order saved offline", "Network connection unavailable. Order queued to sync automatically.");
    router.push(`/pos/receipt/${localOrderId}`);
  }

  async function createReceipt() {
    if (!activeStoreId) {
      Alert.alert("Store missing", "Select an active store before creating receipts.");
      return;
    }
    if (lines.length === 0) {
      Alert.alert("No items", "Add at least one item to create an order.");
      return;
    }

    const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    setSubmitting(true);
    let stockAdjusted = false;

    try {
      const stockById = await fetchStockByProductId(
        activeStoreId,
        lines.map((line) => line.id),
      );
      validateCartQuantities(lines, stockById);

      const fallbackUser = (await supabase.auth.getUser()).data.user?.id ?? null;
      const cashierUserId = userId ?? fallbackUser ?? "local-cashier-id";

      await decrementStockForOrder(activeStoreId, lines);
      stockAdjusted = true;

      try {
        await supabase.from("profiles").upsert({ id: cashierUserId }, { onConflict: "id" });

        const { data: inserted, error } = await supabase
          .from("orders")
          .insert({
            store_id: activeStoreId,
            cashier_user_id: cashierUserId,
            order_number: orderNumber,
            status: "completed",
            subtotal,
            tax,
            discount: discountAmount,
            total,
            tax_rate: taxRate,
            vat_rate: vatRate,
            service_rate: serviceRate,
            discount_mode: discountMode,
            discount_value: discountValue,
            amount_paid: amountPaid,
            change_due: change,
            payment_method: paymentMethod,
            customer_name: customerName || null,
            customer_phone: customerPhone || null,
            customer_id: customerId || null,
            shipping_address: shippingAddress || null,
          })
          .select("id")
          .single();

        if (error) throw error;
        if (!inserted?.id) throw new Error("Order created but missing id.");

        const linesPayload = lines.map((line) => ({
          order_id: inserted.id,
          store_id: activeStoreId,
          product_id: line.remoteId ?? null,
          sku: line.sku ?? line.barcode ?? null,
          barcode: line.barcode ?? null,
          product_name: line.name,
          unit_price: line.price,
          quantity: line.quantity,
          line_total: line.price * line.quantity,
        }));
        await supabase.from("order_items").insert(linesPayload);

        clearDraft();
        router.push(`/pos/receipt/${inserted.id}`);
      } catch (cloudErr) {
        // Network/cloud fail -> Save offline to WatermelonDB SQLite & sync queue
        if (__DEV__) console.warn(`[OmniPOS] Cloud checkout failed, using offline fallback: ${cloudErr}`);
        await saveOrderOffline(orderNumber, cashierUserId);
      }
    } catch (error) {
      if (stockAdjusted) {
        try {
          await restoreStockForOrder(activeStoreId, lines);
        } catch {
          // ignore
        }
      }
      const message =
        error instanceof InsufficientStockError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Failed to create order";
      Alert.alert(error instanceof InsufficientStockError ? "Insufficient stock" : "Create order failed", message);
    } finally {
      setSubmitting(false);
    }
  }

  const paymentMethods: { key: PaymentMethod; label: string; icon: string }[] = [
    { key: "cash", label: "Cash", icon: "cash-outline" },
    { key: "card", label: "Card", icon: "card-outline" },
    { key: "transfer", label: "Transfer", icon: "send-outline" },
    { key: "split", label: "Split", icon: "pie-chart-outline" },
  ];

  return (
    <AppScrollScreen showBack title="Order info" subtitle="Select payment method, apply discounts, and capture customer info.">
      <SectionCard>
        <Text style={styles.totalLabel}>Total price</Text>
        <Text style={styles.totalValue}>
          {sym} {total.toFixed(2)}
        </Text>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionHeaderTitle}>Payment Method</Text>
        <View style={styles.paymentMethodRow}>
          {paymentMethods.map((m) => {
            const active = paymentMethod === m.key;
            return (
              <Pressable
                key={m.key}
                style={[styles.paymentMethodPill, active && styles.paymentMethodPillActive]}
                onPress={() => setPaymentMethod(m.key)}
              >
                <Ionicons name={m.icon as any} size={18} color={active ? Colors.white : Colors.textSecondary} />
                <Text style={[styles.paymentMethodText, active && styles.paymentMethodTextActive]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>
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
          <View style={styles.amountSplitRow}>
            <Text style={styles.changeLabel}>Change</Text>
            <Text style={styles.changeVal}>
              {sym} {change.toFixed(2)}
            </Text>
          </View>
          <View style={styles.amountSplitRow}>
            <Text style={styles.changeLabel}>Balance</Text>
            <Text style={[styles.changeVal, balance > 0 && styles.balanceVal]}>
              {sym} {balance.toFixed(2)}
            </Text>
          </View>
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

      <PrimaryButton
        label={submitting ? "Creating..." : "Create Receipt"}
        loading={submitting}
        disabled={submitting}
        onPress={() => void createReceipt()}
      />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  totalLabel: { fontSize: 22, color: Colors.textPrimary, fontWeight: "600" },
  totalValue: { fontSize: 34, color: Colors.textPrimary, fontWeight: "800", marginTop: 6 },
  sectionHeaderTitle: { fontSize: 16, fontWeight: "700", color: Colors.textPrimary, marginBottom: Spacing.xs },
  paymentMethodRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  paymentMethodPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryBluePale,
    borderWidth: 1,
    borderColor: "transparent",
  },
  paymentMethodPillActive: {
    backgroundColor: Colors.primaryBlue,
    borderColor: Colors.primaryBlue,
  },
  paymentMethodText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  paymentMethodTextActive: {
    color: Colors.white,
  },
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
  amountSplitRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  changeLabel: { fontSize: 20, color: Colors.textPrimary, fontWeight: "600" },
  changeVal: { fontSize: 28, color: "#e05757", fontWeight: "800" },
  balanceVal: { color: Colors.danger },
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
