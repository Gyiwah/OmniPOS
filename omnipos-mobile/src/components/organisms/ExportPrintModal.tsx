import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useMemo, useState } from "react";
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

import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

export type ExportProductItem = {
  id: string;
  name: string;
  sku: string;
  stock: number;
  reorderLevel: number;
  sellPrice: number;
  costPrice?: number | null;
  expiryDate?: string | null;
  expiryStatus?: "good" | "expiring_soon" | "expired" | "no_expiry";
};

type ExportFilter = "all" | "in_stock" | "low_stock" | "out_of_stock" | "expiring_soon" | "expired";

type ExportPrintModalProps = {
  visible: boolean;
  onClose: () => void;
  products: ExportProductItem[];
  currencySymbol?: string;
  storeName?: string;
};

export function ExportPrintModal({
  visible,
  onClose,
  products,
  currencySymbol = "₵",
  storeName = "OmniPOS Store",
}: ExportPrintModalProps) {
  const [filter, setFilter] = useState<ExportFilter>("all");
  const [exporting, setExporting] = useState(false);
  const [viewMode, setViewMode] = useState<"summary" | "preview">("summary");

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (filter === "in_stock") return p.stock > 0;
      if (filter === "low_stock") return p.stock > 0 && p.stock <= p.reorderLevel;
      if (filter === "out_of_stock") return p.stock <= 0;
      if (filter === "expiring_soon") return p.expiryStatus === "expiring_soon";
      if (filter === "expired") return p.expiryStatus === "expired";
      return true;
    });
  }, [products, filter]);

  const metrics = useMemo(() => {
    let totalStock = 0;
    let totalRetailValue = 0;
    let totalCostValue = 0;

    filteredProducts.forEach((p) => {
      const stock = Math.max(0, p.stock);
      totalStock += stock;
      totalRetailValue += stock * (p.sellPrice || 0);
      totalCostValue += stock * (p.costPrice || 0);
    });

    return {
      count: filteredProducts.length,
      totalStock,
      totalRetailValue,
      totalCostValue,
    };
  }, [filteredProducts]);

  async function handleExportCsv() {
    if (filteredProducts.length === 0) {
      Alert.alert("Empty List", "No products match the selected filter to export.");
      return;
    }

    setExporting(true);
    try {
      const headers = [
        "Product Name",
        "SKU",
        "Stock",
        "Reorder Level",
        "Sell Price",
        "Cost Price",
        "Total Sell Value",
        "Expiry Date",
        "Status",
      ];

      const rows = filteredProducts.map((p) => {
        const stockStatus =
          p.stock <= 0 ? "Out of Stock" : p.stock <= p.reorderLevel ? "Low Stock" : "In Stock";
        const sellVal = (p.stock * (p.sellPrice || 0)).toFixed(2);
        return [
          `"${p.name.replace(/"/g, '""')}"`,
          `"${p.sku}"`,
          p.stock,
          p.reorderLevel,
          p.sellPrice.toFixed(2),
          p.costPrice != null ? p.costPrice.toFixed(2) : "",
          sellVal,
          p.expiryDate ?? "",
          stockStatus,
        ].join(",");
      });

      const csvContent = [headers.join(","), ...rows].join("\n");
      const fileName = `Inventory_${filter}_${new Date().toISOString().slice(0, 10)}.csv`;
      const filePath = `${FileSystem.cacheDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(filePath, csvContent, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(filePath, {
          mimeType: "text/csv",
          dialogTitle: "Export Inventory Report",
          UTI: "public.comma-separated-values-text",
        });
      } else {
        Alert.alert("Exported", `File saved to: ${filePath}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed";
      Alert.alert("Export Error", msg);
    } finally {
      setExporting(false);
    }
  }

  const printableReportText = useMemo(() => {
    const dateStr = new Date().toLocaleDateString();
    const divider = "------------------------------------------\n";
    let report = `INVENTORY REPORT - ${storeName.toUpperCase()}\n`;
    report += `Generated: ${dateStr} | Filter: ${filter.toUpperCase()}\n`;
    report += divider;
    report += `Total Products: ${metrics.count}\n`;
    report += `Total Units: ${metrics.totalStock}\n`;
    report += `Total Retail Value: ${currencySymbol} ${metrics.totalRetailValue.toFixed(2)}\n`;
    report += divider;
    report += `NAME | SKU | STOCK | PRICE | VAL\n`;
    report += divider;

    filteredProducts.forEach((p) => {
      const lineVal = (p.stock * p.sellPrice).toFixed(2);
      report += `${p.name.slice(0, 18).padEnd(18)} | ${p.sku.slice(0, 8).padEnd(8)} | ${String(p.stock).padStart(4)} | ${p.sellPrice.toFixed(1)} | ${lineVal}\n`;
    });
    report += divider;
    report += `END OF REPORT\n`;
    return report;
  }, [storeName, filter, metrics, currencySymbol, filteredProducts]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={styles.modalSheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconWrap}>
                <Ionicons name="document-text" size={22} color={Colors.primaryBlue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Export & Print Inventory</Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {storeName} · {products.length} catalog items
                </Text>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={Colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
            {/* Filter Selector */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Stock & Status Filter</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterPillsRow}>
                {[
                  { key: "all", label: "All Items" },
                  { key: "in_stock", label: "In Stock" },
                  { key: "low_stock", label: "Low Stock" },
                  { key: "out_of_stock", label: "Out of Stock" },
                  { key: "expiring_soon", label: "Expiring Soon" },
                  { key: "expired", label: "Expired" },
                ].map((item) => {
                  const isSelected = filter === item.key;
                  return (
                    <Pressable
                      key={item.key}
                      style={[styles.filterPill, isSelected && styles.filterPillActive]}
                      onPress={() => setFilter(item.key as ExportFilter)}
                    >
                      <Text style={[styles.filterText, isSelected && styles.filterTextActive]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Metrics Summary Cards */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricCaption}>Filtered Items</Text>
                <Text style={styles.metricValue}>{metrics.count}</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricCaption}>Total Quantity</Text>
                <Text style={styles.metricValue}>{metrics.totalStock} units</Text>
              </View>
              <View style={[styles.metricCard, styles.metricCardSpan]}>
                <Text style={styles.metricCaption}>Estimated Retail Valuation</Text>
                <Text style={[styles.metricValue, { color: Colors.primaryBlue, fontSize: 18 }]}>
                  {currencySymbol} {metrics.totalRetailValue.toFixed(2)}
                </Text>
              </View>
            </View>

            {/* View Mode Toggle */}
            <View style={styles.tabRow}>
              <Pressable
                style={[styles.tabBtn, viewMode === "summary" && styles.tabBtnActive]}
                onPress={() => setViewMode("summary")}
              >
                <Ionicons
                  name="list-outline"
                  size={16}
                  color={viewMode === "summary" ? Colors.primaryBlue : Colors.textMuted}
                />
                <Text style={[styles.tabBtnText, viewMode === "summary" && styles.tabBtnTextActive]}>
                  Catalog Summary
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tabBtn, viewMode === "preview" && styles.tabBtnActive]}
                onPress={() => setViewMode("preview")}
              >
                <Ionicons
                  name="print-outline"
                  size={16}
                  color={viewMode === "preview" ? Colors.primaryBlue : Colors.textMuted}
                />
                <Text style={[styles.tabBtnText, viewMode === "preview" && styles.tabBtnTextActive]}>
                  Thermal Preview
                </Text>
              </Pressable>
            </View>

            {viewMode === "summary" ? (
              <View style={styles.tableList}>
                {filteredProducts.slice(0, 25).map((p) => (
                  <View key={p.id} style={styles.tableRow}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={styles.rowSub}>
                        SKU: {p.sku} · Reorder Level: {p.reorderLevel}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.rowStock}>Stock: {p.stock}</Text>
                      <Text style={styles.rowPrice}>
                        {currencySymbol} {p.sellPrice.toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ))}
                {filteredProducts.length > 25 ? (
                  <Text style={styles.moreNote}>
                    + {filteredProducts.length - 25} more products included in full export
                  </Text>
                ) : null}
                {filteredProducts.length === 0 ? (
                  <Text style={styles.emptyText}>No products matching this filter.</Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.previewBox}>
                <Text style={styles.monoText}>{printableReportText}</Text>
              </View>
            )}
          </ScrollView>

          {/* Export Action */}
          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [
                styles.exportBtn,
                (exporting || filteredProducts.length === 0) && styles.exportBtnDisabled,
                pressed && styles.exportBtnPressed,
              ]}
              disabled={exporting || filteredProducts.length === 0}
              onPress={() => void handleExportCsv()}
            >
              {exporting ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Ionicons name="share-outline" size={20} color={Colors.white} />
              )}
              <Text style={styles.exportBtnText}>
                {exporting ? "Generating CSV Report..." : "Share / Export CSV Report"}
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
    maxHeight: "88%",
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
    backgroundColor: Colors.primaryBluePale,
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
  filterPillsRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    paddingVertical: 4,
  },
  filterPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterPillActive: {
    backgroundColor: Colors.primaryBlue,
    borderColor: Colors.primaryBlue,
  },
  filterText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  filterTextActive: {
    color: Colors.white,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  metricCard: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  metricCardSpan: {
    minWidth: "100%",
  },
  metricCaption: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: "600",
  },
  metricValue: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
    marginTop: 2,
  },
  tabRow: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderRadius: Radius.input,
    padding: 3,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: Radius.input - 2,
  },
  tabBtnActive: {
    backgroundColor: Colors.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textMuted,
  },
  tabBtnTextActive: {
    color: Colors.primaryBlue,
  },
  tableList: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  tableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f1f5f9",
  },
  rowTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  rowSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  rowStock: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  rowPrice: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.primaryBlue,
    marginTop: 1,
  },
  moreNote: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: Colors.primaryBlue,
    paddingVertical: 10,
    backgroundColor: Colors.primaryBluePale,
  },
  emptyText: {
    textAlign: "center",
    color: Colors.textMuted,
    paddingVertical: Spacing.md,
    fontSize: 13,
  },
  previewBox: {
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  monoText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: Colors.textPrimary,
    lineHeight: 16,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primaryBlue,
    borderRadius: Radius.pill,
    paddingVertical: 15,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  exportBtnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  exportBtnDisabled: {
    opacity: 0.5,
  },
  exportBtnText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: "800",
  },
});
