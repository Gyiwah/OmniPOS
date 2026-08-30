import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
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
  const sym = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";

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

  async function loadOrder(overrideRef?: string) {
    if (!activeStoreId) {
      Alert.alert("Store Missing", "Select an active store before processing returns.");
      return;
    }
    const cleanRef = (overrideRef ?? orderRef).trim().replace(/^\*|\*$/g, "");
    if (!cleanRef) {
      Alert.alert("Order Required", "Enter or scan a receipt or order number.");
      return;
    }

    setLoadingOrder(true);
    try {
      const found = await lookupOrderForReturn(activeStoreId, cleanRef);
      if (!found) {
        Alert.alert("Order Not Found", "No matching order was found for this store.");
        setOrder(null);
        setCounts({});
        return;
      }
      if (found.items.length === 0) {
        Alert.alert("No Items", "This order has no line items available for return.");
        setOrder(null);
        setCounts({});
        return;
      }

      setOrder(found);
      setCounts(Object.fromEntries(found.items.map((item) => [item.id, 0])));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load order";
      Alert.alert("Load Failed", message);
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
        Alert.alert("Not Signed In", "Sign in again before processing a return.");
        return;
      }

      const returnId = await processReturn({
        storeId: activeStoreId,
        orderId: order.id,
        reason: reason.trim() || "Customer return",
        lines,
        processedByUserId,
      });

      Alert.alert("Return Processed", `Refund of ${money(calculateRefundAmount(lines), currency)} recorded successfully.`);
      router.replace(`/pos/return/${returnId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to process return";
      Alert.alert("Return Failed", message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppScrollScreen
      showBack
      title="Process Return"
      subtitle="Lookup receipt, select returned units, and compute refunds."
    >
      {/* Lookup Order Card */}
      <SectionCard>
        <TextInput
          label="Order Number or Barcode"
          value={orderRef}
          onChangeText={setOrderRef}
          placeholder="e.g. ORD-123456"
          leftIcon={<Ionicons name="receipt-outline" size={18} color={Colors.textMuted} />}
          rightIcon={
            <Pressable
              onPress={() => setShowScanner((v) => !v)}
              hitSlop={10}
              style={{ padding: 4 }}
            >
              <Ionicons
                name={showScanner ? "close-circle" : "barcode-outline"}
                size={22}
                color={Colors.primaryBlue}
              />
            </Pressable>
          }
        />

        {showScanner ? (
          <View style={styles.scannerWrapper}>
            <BarcodeScanner
              label="Scan receipt barcode"
              onScan={(payload) => {
                const clean = payload.trim().replace(/^\*|\*$/g, "");
                setOrderRef(clean);
                setShowScanner(false);
                void loadOrder(clean);
              }}
            />
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.lookupBtn,
            loadingOrder && { opacity: 0.7 },
            pressed && { opacity: 0.9 },
          ]}
          disabled={loadingOrder}
          onPress={() => void loadOrder()}
        >
          {loadingOrder ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Ionicons name="search-outline" size={18} color={Colors.white} />
          )}
          <Text style={styles.lookupBtnText}>{loadingOrder ? "Locating Order..." : "Find Order"}</Text>
        </Pressable>

        <TextInput
          label="Return Reason"
          value={reason}
          onChangeText={setReason}
          placeholder="e.g. Defective item, wrong size, or customer change of mind..."
          leftIcon={<Ionicons name="help-circle-outline" size={18} color={Colors.textMuted} />}
        />
      </SectionCard>

      {/* Loaded Order Items */}
      {order ? (
        <SectionCard>
          {/* Order Header Summary */}
          <View style={styles.orderSummaryCard}>
            <View>
              <Text style={styles.orderNumberLabel}>Order #{order.orderNumber}</Text>
              <Text style={styles.orderDateLabel}>
                {new Date(order.createdAt).toLocaleString()} {order.customerName ? `· ${order.customerName}` : ""}
              </Text>
            </View>
            <View style={styles.matchedBadge}>
              <Text style={styles.matchedBadgeText}>Matched</Text>
            </View>
          </View>

          <Text style={styles.sectionSubtitle}>Select Items & Quantities to Return</Text>

          <View style={styles.itemsList}>
            {order.items.map((line) => {
              const remaining = line.purchasedQty - line.returnedQty;
              const current = counts[line.id] ?? 0;
              const isFullyReturned = remaining <= 0;

              return (
                <View key={line.id} style={[styles.itemRow, isFullyReturned && styles.itemRowDisabled]}>
                  <View style={styles.itemMeta}>
                    <Text style={styles.itemName}>{line.name}</Text>
                    <Text style={styles.itemSubText}>
                      Purchased: {line.purchasedQty} {line.returnedQty > 0 ? `· Prev. Returned: ${line.returnedQty}` : ""}
                    </Text>
                    <Text style={styles.unitPriceText}>
                      {money(line.unitPrice, currency)} / unit · Eligible: {remaining}
                    </Text>
                  </View>

                  {/* Quantity Stepper */}
                  <View style={styles.stepperBox}>
                    <Pressable
                      style={({ pressed }) => [styles.stepBtn, pressed && { backgroundColor: "#e2e8f0" }]}
                      onPress={() => updateCount(line.id, remaining, current - 1)}
                      disabled={isFullyReturned || current === 0}
                    >
                      <Ionicons name="remove" size={16} color={current === 0 ? Colors.textMuted : Colors.danger} />
                    </Pressable>
                    <Text style={styles.stepValue}>{current}</Text>
                    <Pressable
                      style={({ pressed }) => [
                        styles.stepBtn,
                        (isFullyReturned || current >= remaining) && styles.stepBtnDisabled,
                        pressed && { backgroundColor: "#e2e8f0" },
                      ]}
                      onPress={() => updateCount(line.id, remaining, current + 1)}
                      disabled={isFullyReturned || current >= remaining}
                    >
                      <Ionicons name="add" size={16} color={current >= remaining ? Colors.textMuted : Colors.primaryBlue} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Refund Calculation Box */}
          <View style={styles.refundTotalBox}>
            <View style={styles.refundRow}>
              <Text style={styles.refundRowLabel}>Units to Return</Text>
              <Text style={styles.refundRowValue}>{totalItems} units</Text>
            </View>
            <View style={styles.refundRow}>
              <Text style={styles.refundTotalLabel}>Total Refund Amount</Text>
              <Text style={styles.refundTotalValue}>{money(refundTotal, currency)}</Text>
            </View>
          </View>
        </SectionCard>
      ) : null}

      {/* Confirm Return Primary Action */}
      {order ? (
        <View style={styles.submitContainer}>
          <Pressable
            style={({ pressed }) => [
              styles.confirmButton,
              (!order || submitting || totalItems === 0) && styles.confirmButtonDisabled,
              pressed && styles.confirmButtonPressed,
            ]}
            disabled={!order || submitting || totalItems === 0}
            onPress={() => void confirmReturn()}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Ionicons name="return-down-back-outline" size={20} color={Colors.white} />
            )}
            <Text style={styles.confirmButtonText}>
              {submitting ? "Processing Refund..." : `Confirm Return & Refund (${money(refundTotal, currency)})`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  scannerWrapper: {
    marginTop: Spacing.xs,
    borderRadius: Radius.card,
    overflow: "hidden",
  },
  lookupBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 12,
    borderRadius: Radius.input,
    marginTop: Spacing.xs,
  },
  lookupBtnText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: "700",
  },
  orderSummaryCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.input,
    padding: Spacing.sm + 2,
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  orderNumberLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  orderDateLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  matchedBadge: {
    backgroundColor: Colors.primaryBlue,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  matchedBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.white,
  },
  sectionSubtitle: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textMuted,
    textTransform: "uppercase",
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  itemsList: {
    gap: Spacing.xs,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    gap: Spacing.sm,
  },
  itemRowDisabled: {
    opacity: 0.5,
  },
  itemMeta: {
    flex: 1,
    gap: 2,
  },
  itemName: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  itemSubText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  unitPriceText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.primaryBlue,
  },
  stepperBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 2,
  },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnDisabled: {
    opacity: 0.3,
  },
  stepValue: {
    minWidth: 28,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  refundTotalBox: {
    marginTop: Spacing.md,
    backgroundColor: "#fff1f2",
    borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: "#fecdd3",
    gap: 6,
  },
  refundRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  refundRowLabel: {
    fontSize: 13,
    color: "#881337",
    fontWeight: "600",
  },
  refundRowValue: {
    fontSize: 14,
    fontWeight: "800",
    color: "#881337",
  },
  refundTotalLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.danger,
  },
  refundTotalValue: {
    fontSize: 22,
    fontWeight: "900",
    color: Colors.danger,
  },
  submitContainer: {
    marginTop: Spacing.xs,
    marginBottom: Spacing.xl,
  },
  confirmButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.danger,
    paddingVertical: 16,
    borderRadius: Radius.pill,
    shadowColor: Colors.danger,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: "800",
  },
});
