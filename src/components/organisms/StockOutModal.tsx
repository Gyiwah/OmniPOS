import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { TextInput } from "@/src/components/atoms/TextInput";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import type ProductBatch from "@/src/database/models/ProductBatch";
import { getProductBatches } from "@/src/features/inventory/batchService";
import {
  performStockOut,
  type StockOutReason,
} from "@/src/features/inventory/stockMovementService";

const REASONS: { label: StockOutReason; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: "Damaged / Broken", icon: "alert-circle-outline" },
  { label: "Expired", icon: "time-outline" },
  { label: "Lost / Theft", icon: "warning-outline" },
  { label: "Internal Use / Sample", icon: "cafe-outline" },
  { label: "Returned to Vendor", icon: "return-up-back-outline" },
  { label: "Inventory Count Correction", icon: "calculator-outline" },
  { label: "Other", icon: "ellipsis-horizontal-circle-outline" },
];

type StockOutModalProps = {
  visible: boolean;
  onClose: () => void;
  storeId: string;
  productId: string;
  productName: string;
  currentStock: number;
  onStockUpdated: (newStock: number) => void;
};

export function StockOutModal({
  visible,
  onClose,
  storeId,
  productId,
  productName,
  currentStock,
  onStockUpdated,
}: StockOutModalProps) {
  const [quantity, setQuantity] = useState("1");
  const [selectedReason, setSelectedReason] = useState<StockOutReason>("Damaged / Broken");
  const [notes, setNotes] = useState("");
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [reasonDropdownOpen, setReasonDropdownOpen] = useState(false);
  const [batchDropdownOpen, setBatchDropdownOpen] = useState(false);

  useEffect(() => {
    if (visible && storeId && productId) {
      setQuantity("1");
      setSelectedReason("Damaged / Broken");
      setNotes("");
      setSelectedBatchId(undefined);

      void getProductBatches(storeId, productId).then((res) => {
        setBatches(res.filter((b) => Number(b.quantity ?? 0) > 0));
      });
    }
  }, [visible, storeId, productId]);

  async function handleConfirm() {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      Alert.alert("Invalid Quantity", "Please enter a valid number greater than 0.");
      return;
    }
    if (qty > currentStock) {
      Alert.alert(
        "Insufficient Stock",
        `Cannot deduct ${qty} units. Current stock is ${currentStock}.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await performStockOut({
        storeId,
        productId,
        quantity: Math.floor(qty),
        reason: selectedReason,
        batchId: selectedBatchId,
        notes: notes.trim() || undefined,
      });

      if (!result.success) {
        Alert.alert("Stock Out Failed", result.error ?? "Failed to adjust stock.");
        return;
      }

      Alert.alert(
        "Stock Removed",
        `Successfully removed ${Math.floor(qty)} unit(s) of "${productName}". New stock balance: ${result.newStock}.`,
      );
      onStockUpdated(result.newStock);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error processing stock out";
      Alert.alert("Stock Out Error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={styles.modalSheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconWrap}>
                <Ionicons name="remove-circle" size={22} color={Colors.danger} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Stock Out / Write-Off</Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {productName}
                </Text>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={Colors.textMuted} />
            </Pressable>
          </View>

          {/* Available Stock Warning Banner */}
          <View style={styles.stockNoticeBox}>
            <Text style={styles.stockNoticeLabel}>Current Available Inventory</Text>
            <Text style={styles.stockNoticeValue}>{currentStock} units</Text>
          </View>

          <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
            {/* Quantity Input with Quick Selector */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Quantity to Deduct *</Text>
              <TextInput
                value={quantity}
                onChangeText={setQuantity}
                placeholder="1"
                keyboardType="number-pad"
                leftIcon={<Ionicons name="calculator-outline" size={18} color={Colors.textMuted} />}
              />

              <View style={styles.quickQtyRow}>
                <Pressable style={styles.quickQtyPill} onPress={() => setQuantity("1")}>
                  <Text style={styles.quickQtyText}>1 Unit</Text>
                </Pressable>
                {currentStock >= 5 ? (
                  <Pressable style={styles.quickQtyPill} onPress={() => setQuantity("5")}>
                    <Text style={styles.quickQtyText}>5 Units</Text>
                  </Pressable>
                ) : null}
                {currentStock >= 10 ? (
                  <Pressable style={styles.quickQtyPill} onPress={() => setQuantity("10")}>
                    <Text style={styles.quickQtyText}>10 Units</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[styles.quickQtyPill, { backgroundColor: "#fee2e2" }]}
                  onPress={() => setQuantity(String(currentStock))}
                >
                  <Text style={[styles.quickQtyText, { color: Colors.danger }]}>All ({currentStock})</Text>
                </Pressable>
              </View>
            </View>

            {/* Batch Selector if batches exist */}
            {batches.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Deduct from Specific Batch</Text>
                <Pressable
                  style={styles.dropdownTrigger}
                  onPress={() => setBatchDropdownOpen((v) => !v)}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                    <Ionicons name="layers-outline" size={18} color={Colors.primaryBlue} />
                    <Text style={styles.dropdownTriggerText}>
                      {selectedBatchId
                        ? (() => {
                            const b = batches.find((x) => x.id === selectedBatchId);
                            return b ? `Batch #${b.batchNumber} (${b.quantity} left)` : "Select Batch";
                          })()
                        : "Auto (FIFO - First Expiring / Oldest)"}
                    </Text>
                  </View>
                  <Ionicons
                    name={batchDropdownOpen ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={Colors.textMuted}
                  />
                </Pressable>

                {batchDropdownOpen ? (
                  <View style={styles.dropdownMenu}>
                    <Pressable
                      style={[
                        styles.dropdownItem,
                        selectedBatchId === undefined && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setSelectedBatchId(undefined);
                        setBatchDropdownOpen(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          selectedBatchId === undefined && styles.dropdownItemTextActive,
                        ]}
                      >
                        Auto (FIFO - Recommended)
                      </Text>
                      {selectedBatchId === undefined ? (
                        <Ionicons name="checkmark" size={18} color={Colors.primaryBlue} />
                      ) : null}
                    </Pressable>
                    {batches.map((b) => (
                      <Pressable
                        key={b.id}
                        style={[
                          styles.dropdownItem,
                          selectedBatchId === b.id && styles.dropdownItemActive,
                        ]}
                        onPress={() => {
                          setSelectedBatchId(b.id);
                          setBatchDropdownOpen(false);
                        }}
                      >
                        <Text
                          style={[
                            styles.dropdownItemText,
                            selectedBatchId === b.id && styles.dropdownItemTextActive,
                          ]}
                        >
                          Batch #{b.batchNumber} ({b.quantity} units)
                          {b.expiryDate ? ` · Exp: ${b.expiryDate}` : ""}
                        </Text>
                        {selectedBatchId === b.id ? (
                          <Ionicons name="checkmark" size={18} color={Colors.primaryBlue} />
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Reason Selector Dropdown */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Reason for Write-Off *</Text>
              <Pressable
                style={styles.dropdownTrigger}
                onPress={() => setReasonDropdownOpen((v) => !v)}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                  <Ionicons name="alert-circle-outline" size={18} color={Colors.danger} />
                  <Text style={styles.dropdownTriggerText}>{selectedReason}</Text>
                </View>
                <Ionicons
                  name={reasonDropdownOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={Colors.textMuted}
                />
              </Pressable>

              {reasonDropdownOpen ? (
                <View style={styles.dropdownMenu}>
                  {REASONS.map((r) => {
                    const isSelected = selectedReason === r.label;
                    return (
                      <Pressable
                        key={r.label}
                        style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}
                        onPress={() => {
                          setSelectedReason(r.label);
                          setReasonDropdownOpen(false);
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Ionicons name={r.icon} size={16} color={isSelected ? Colors.primaryBlue : Colors.textMuted} />
                          <Text
                            style={[
                              styles.dropdownItemText,
                              isSelected && styles.dropdownItemTextActive,
                            ]}
                          >
                            {r.label}
                          </Text>
                        </View>
                        {isSelected ? (
                          <Ionicons name="checkmark" size={18} color={Colors.primaryBlue} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>

            {/* Notes / Memo */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Audit Notes / Memo (Optional)</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. Broken in storage aisle 2, batch returned"
                multiline
                numberOfLines={3}
                leftIcon={<Ionicons name="document-text-outline" size={18} color={Colors.textMuted} />}
              />
            </View>
          </ScrollView>

          {/* Modal Footer Actions */}
          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [
                styles.confirmBtn,
                (submitting || currentStock <= 0) && styles.confirmBtnDisabled,
                pressed && styles.confirmBtnPressed,
              ]}
              disabled={submitting || currentStock <= 0}
              onPress={() => void handleConfirm()}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Ionicons name="trash-outline" size={18} color={Colors.white} />
              )}
              <Text style={styles.confirmBtnText}>
                {submitting ? "Deducting Units..." : "Confirm Stock Write-Off"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "85%",
    paddingBottom: Spacing.xl,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  headerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#fff1f2",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  stockNoticeBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff7ed",
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#fed7aa",
  },
  stockNoticeLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#c2410c",
  },
  stockNoticeValue: {
    fontSize: 13,
    fontWeight: "800",
    color: "#c2410c",
  },
  scrollBody: {
    paddingHorizontal: Spacing.lg,
  },
  scrollContent: {
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  section: {
    gap: Spacing.xs,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  quickQtyRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    marginTop: 4,
  },
  quickQtyPill: {
    flex: 1,
    alignItems: "center",
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingVertical: 8,
  },
  quickQtyText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
  },
  dropdownTriggerText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  dropdownMenu: {
    marginTop: Spacing.xs,
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  dropdownItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f1f5f9",
  },
  dropdownItemActive: {
    backgroundColor: Colors.primaryBluePale,
  },
  dropdownItemText: {
    fontSize: 13,
    color: Colors.textPrimary,
  },
  dropdownItemTextActive: {
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.danger,
    borderRadius: Radius.pill,
    paddingVertical: 15,
    shadowColor: Colors.danger,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmBtnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  confirmBtnDisabled: {
    opacity: 0.5,
  },
  confirmBtnText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: "800",
  },
});
