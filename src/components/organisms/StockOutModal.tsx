import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
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

const REASONS: StockOutReason[] = [
  "Damaged / Broken",
  "Expired",
  "Lost / Theft",
  "Internal Use / Sample",
  "Returned to Vendor",
  "Inventory Count Correction",
  "Other",
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
      Alert.alert("Invalid quantity", "Please enter a valid number greater than 0.");
      return;
    }
    if (qty > currentStock) {
      Alert.alert(
        "Insufficient stock",
        `Cannot remove ${qty} units. Current stock is ${currentStock}.`,
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
        Alert.alert("Stock out failed", result.error ?? "Failed to adjust stock.");
        return;
      }

      Alert.alert(
        "Stock Removed",
        `Successfully removed ${Math.floor(qty)} unit(s) of "${productName}". New stock: ${result.newStock}.`,
      );
      onStockUpdated(result.newStock);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error processing stock out";
      Alert.alert("Error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalSheet}>
          <View style={styles.header}>
            <View style={styles.titleWrap}>
              <Text style={styles.title}>Stock Out / Write-off</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {productName} · Available: {currentStock}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close-circle-outline" size={24} color={Colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
            {/* Quantity Section */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Quantity to Remove</Text>
              <TextInput
                value={quantity}
                onChangeText={setQuantity}
                placeholder="1"
                keyboardType="number-pad"
              />
              <View style={styles.quickQtyRow}>
                <Pressable
                  style={styles.quickQtyPill}
                  onPress={() => setQuantity("1")}
                >
                  <Text style={styles.quickQtyText}>1</Text>
                </Pressable>
                {currentStock >= 5 ? (
                  <Pressable
                    style={styles.quickQtyPill}
                    onPress={() => setQuantity("5")}
                  >
                    <Text style={styles.quickQtyText}>5</Text>
                  </Pressable>
                ) : null}
                {currentStock >= 10 ? (
                  <Pressable
                    style={styles.quickQtyPill}
                    onPress={() => setQuantity("10")}
                  >
                    <Text style={styles.quickQtyText}>10</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={styles.quickQtyPill}
                  onPress={() => setQuantity(String(currentStock))}
                >
                  <Text style={styles.quickQtyText}>All ({currentStock})</Text>
                </Pressable>
              </View>
            </View>

            {/* Batch Selector if batches exist */}
            {batches.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Deduct from Batch (Optional)</Text>
                <Pressable
                  style={styles.dropdownTrigger}
                  onPress={() => setBatchDropdownOpen((v) => !v)}
                >
                  <Ionicons name="layers-outline" size={18} color={Colors.primaryBlue} />
                  <Text style={styles.dropdownTriggerText}>
                    {selectedBatchId
                      ? (() => {
                          const b = batches.find((x) => x.id === selectedBatchId);
                          return b ? `Batch #${b.batchNumber} (${b.quantity} left)` : "Select Batch";
                        })()
                      : "Auto (FIFO - First Expiring / Oldest)"}
                  </Text>
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
                          Batch #{b.batchNumber} ({b.quantity} left)
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
              <Text style={styles.sectionLabel}>Reason for Removal</Text>
              <Pressable
                style={styles.dropdownTrigger}
                onPress={() => setReasonDropdownOpen((v) => !v)}
              >
                <Ionicons name="alert-circle-outline" size={18} color={Colors.primaryBlue} />
                <Text style={styles.dropdownTriggerText}>{selectedReason}</Text>
                <Ionicons
                  name={reasonDropdownOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={Colors.textMuted}
                />
              </Pressable>

              {reasonDropdownOpen ? (
                <View style={styles.dropdownMenu}>
                  {REASONS.map((r) => {
                    const isSelected = selectedReason === r;
                    return (
                      <Pressable
                        key={r}
                        style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}
                        onPress={() => {
                          setSelectedReason(r);
                          setReasonDropdownOpen(false);
                        }}
                      >
                        <Text
                          style={[
                            styles.dropdownItemText,
                            isSelected && styles.dropdownItemTextActive,
                          ]}
                        >
                          {r}
                        </Text>
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
              <Text style={styles.sectionLabel}>Notes / Reference (Optional)</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. Broken in storage aisle 2, batch returned"
                multiline
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label={submitting ? "Processing..." : "Confirm Stock Out"}
              loading={submitting}
              disabled={submitting || currentStock <= 0}
              onPress={() => void handleConfirm()}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: "85%",
    paddingBottom: Spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  titleWrap: {
    flex: 1,
    paddingRight: Spacing.sm,
  },
  title: {
    ...Typography.title,
    color: Colors.textPrimary,
    fontSize: 18,
  },
  subtitle: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    padding: Spacing.xs,
  },
  scrollBody: {
    maxHeight: 400,
  },
  scrollContent: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  section: {
    gap: Spacing.xs,
  },
  sectionLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  quickQtyRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    marginTop: 4,
  },
  quickQtyPill: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  quickQtyText: {
    fontSize: 12,
    color: Colors.textPrimary,
    fontWeight: "600",
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
    minHeight: 46,
  },
  dropdownTriggerText: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: "600",
  },
  dropdownMenu: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    marginTop: 4,
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.divider,
  },
  dropdownItemActive: {
    backgroundColor: Colors.primaryBluePale,
  },
  dropdownItemText: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: "500",
    flex: 1,
  },
  dropdownItemTextActive: {
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
  footer: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
});
