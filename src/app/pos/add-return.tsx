import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { BarcodeScanner } from "@/src/components/organisms/BarcodeScanner";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import {
  calculateRefundAmount,
  lookupOrderForReturn,
  processReturn,
  validateReturnSelections,
} from "@/src/features/returns/service";
import type { OrderForReturn } from "@/src/features/returns/types";
import { supabase } from "@/src/services/supabase";
import { useAuthStore } from "@/src/store/authStore";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";

function money(value: number, currency: string) {
  const symbol = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";
  return `${symbol} ${value.toFixed(2)}`;
}

export default function AddReturnScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const userId = useAuthStore((s) => s.userId);
  const currency = useSettingsStore((s) => s.currency);

  const [orderRef, setOrderRef] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [reason, setReason] = useState("");
  const [order, setOrder] = useState<OrderForReturn | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedLines = useMemo(() => {
    if (!order) return [];
    try {
      return validateReturnSelections(order, counts);
    } catch {
      return [];
    }
  }, [counts, order]);

  const refundTotal = useMemo(() => calculateRefundAmount(selectedLines), [selectedLines]);
  const totalItems = useMemo(
    () => Object.values(counts).reduce((sum, next) => sum + next, 0),
    [counts],
  );

  async function loadOrder() {
    if (!activeStoreId) {
      Alert.alert("Store missing", "Select an active store before processing returns.");
      return;
    }
    const cleanRef = orderRef.trim();
    if (!cleanRef) {
      Alert.alert("Order required", "Enter or scan a receipt / order number.");
      return;
    }

    setLoadingOrder(true);
    try {
      const found = await lookupOrderForReturn(activeStoreId, cleanRef);
      if (!found) {
        Alert.alert("Order not found", "No matching order was found for this store.");
        setOrder(null);
        setCounts({});
        return;
      }
      if (found.items.length === 0) {
        Alert.alert("No items", "This order has no line items to return.");
        setOrder(null);
        setCounts({});
        return;
      }

      setOrder(found);
      setCounts(Object.fromEntries(found.items.map((item) => [item.id, 0])));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load order";
      Alert.alert("Load failed", message);
    } finally {
      setLoadingOrder(false);
    }
  }

  function updateCount(itemId: string, maxRemaining: number, next: number) {
    setCounts((current) => ({
      ...current,
      [itemId]: Math.max(0, Math.min(maxRemaining, next)),
    }));
  }

  async function confirmReturn() {
    if (!activeStoreId || !order) return;

    setSubmitting(true);
    try {
      const lines = validateReturnSelections(order, counts);
      const fallbackUser = (await supabase.auth.getUser()).data.user?.id ?? null;
      const processedByUserId = userId ?? fallbackUser;
      if (!processedByUserId) {
        Alert.alert("Not signed in", "Sign in again before processing a return.");
        return;
      }

      const returnId = await processReturn({
        storeId: activeStoreId,
        orderId: order.id,
        reason,
        lines,
        processedByUserId,
      });

      Alert.alert("Return processed", `Refund ${money(calculateRefundAmount(lines), currency)} recorded.`);
      router.replace(`/pos/return/${returnId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to process return";
      Alert.alert("Return failed", message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppScrollScreen showBack title="Process return" subtitle="Match receipt/order and select item counts.">
      <SectionCard>
        <TextInput
          label="Receipt / order #"
          value={orderRef}
          onChangeText={setOrderRef}
          placeholder="ORD-1042 or order UUID"
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
            label="Align receipt or order barcode inside frame"
            onScan={(payload) => {
              setOrderRef(payload);
              setShowScanner(false);
            }}
          />
        ) : null}
        <PrimaryButton
          label={loadingOrder ? "Loading order..." : "Load order"}
          variant="outline"
          loading={loadingOrder}
          disabled={loadingOrder || submitting}
          onPress={() => void loadOrder()}
        />
        <TextInput label="Reason" value={reason} onChangeText={setReason} placeholder="Damaged, wrong item, …" />
      </SectionCard>

      {order ? (
        <SectionCard>
          <Text style={styles.sectionTitle}>Order {order.orderNumber}</Text>
          <Text style={styles.orderMeta}>
            {new Date(order.createdAt).toLocaleString()}
            {order.customerName ? ` · ${order.customerName}` : ""}
          </Text>
          <Text style={styles.sectionTitle}>Items to refund</Text>
          <View style={styles.itemsWrap}>
            {order.items.map((line) => {
              const remaining = line.purchasedQty - line.returnedQty;
              const current = counts[line.id] ?? 0;
              return (
                <View key={line.id} style={styles.returnRow}>
                  <View style={styles.meta}>
                    <Text style={styles.name}>{line.name}</Text>
                    <Text style={styles.sub}>
                      Purchased {line.purchasedQty}
                      {line.returnedQty > 0 ? ` · Returned ${line.returnedQty}` : ""} · {money(line.unitPrice, currency)}
                    </Text>
                    <Text style={styles.sub}>Remaining {remaining}</Text>
                  </View>
                  <View style={styles.counter}>
                    <Pressable
                      onPress={() => updateCount(line.id, remaining, current - 1)}
                      style={styles.counterBtn}
                      disabled={remaining <= 0}
                    >
                      <Text style={styles.counterBtnText}>-</Text>
                    </Pressable>
                    <Text style={styles.counterVal}>{current}</Text>
                    <Pressable
                      onPress={() => updateCount(line.id, remaining, current + 1)}
                      style={[styles.counterBtn, (remaining <= 0 || current >= remaining) && styles.counterBtnDisabled]}
                      disabled={remaining <= 0 || current >= remaining}
                    >
                      <Text style={styles.counterBtnText}>+</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
          <Text style={styles.total}>Total return items: {totalItems}</Text>
          <Text style={styles.refundTotal}>Refund total: {money(refundTotal, currency)}</Text>
        </SectionCard>
      ) : null}

      <PrimaryButton
        label={submitting ? "Processing..." : "Confirm return"}
        loading={submitting}
        disabled={!order || submitting || totalItems === 0}
        onPress={() => void confirmReturn()}
      />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  orderMeta: {
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  itemsWrap: {
    gap: Spacing.sm,
  },
  returnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  meta: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  sub: {
    marginTop: 4,
    fontSize: 12,
    color: Colors.textMuted,
  },
  counter: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 4,
  },
  counterBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  counterBtnDisabled: {
    opacity: 0.4,
  },
  counterBtnText: {
    color: Colors.primaryBlue,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 20,
  },
  counterVal: {
    minWidth: 26,
    textAlign: "center",
    color: Colors.textPrimary,
    fontWeight: "700",
  },
  total: {
    marginTop: Spacing.sm,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  refundTotal: {
    marginTop: Spacing.xs,
    color: Colors.accentOrange,
    fontWeight: "800",
    fontSize: 16,
  },
});
