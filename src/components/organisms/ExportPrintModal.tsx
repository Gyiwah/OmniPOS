import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useMemo, useState } from "react";
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
        <View style={styles.modalSheet}>
          <View style={styles.header}>
            <View style={styles.titleWrap}>
              <Text style={styles.title}>Export & Print Inventory</Text>
              <Text style={styles.subtitle}>Filter, export CSV, or print stock list</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close-circle-outline" size={24} color={Colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
            {/* Filter Selector */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Filter by Stock & Expiry</Text>
              <View style={styles.filterPillsRow}>
                {[
                  { key: "all", label: "All Items" },
                  { key: "in_stock", label: "In Stock" },
                  { key: "low_stock", label: "Low Stock" },
                  { key: "out_of_stock", label: "Out of Stock" },
                  { key: "expiring_soon", label: "Expiring Soon" },
                  { key: "expired", label: "Expired" },
                ].map((item) => (
                  <Pressable
                    key={item.key}
                    style={[
                      styles.filterPill,
                      filter === item.key && styles.filterPillActive,
                    ]}
                    onPress={() => setFilter(item.key as ExportFilter)}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        filter === item.key && styles.filterTextActive,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Metrics Summary Cards */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricCaption}>Matching Items</Text>
                <Text style={styles.metricValue}>{metrics.count}</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricCaption}>Total Stock Units</Text>
                <Text style={styles.metricValue}>{metrics.totalStock}</Text>
              </View>
              <View style={[styles.metricCard, styles.metricCardSpan]}>
                <Text style={styles.metricCaption}>Total Retail Valuation</Text>
                <Text style={[styles.metricValue, { color: Colors.primaryBlue }]}>
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
                <Text
                  style={[styles.tabBtnText, viewMode === "summary" && styles.tabBtnTextActive]}
                >
                  Table Summary
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tabBtn, viewMode === "preview" && styles.tabBtnActive]}
                onPress={() => setViewMode("preview")}
              >
                <Text
                  style={[styles.tabBtnText, viewMode === "preview" && styles.tabBtnTextActive]}
                >
                  Print Preview
                </Text>
              </Pressable>
            </View>

            {viewMode === "summary" ? (
              <View style={styles.tableList}>
                {filteredProducts.slice(0, 25).map((p) => (
                  <View key={p.id} style={styles.tableRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={styles.rowSub}>
                        SKU: {p.sku} · Reorder: {p.reorderLevel}
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
                    + {filteredProducts.length - 25} more items included in export
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

          <View style={styles.footer}>
            <PrimaryButton
              label={exporting ? "Generating CSV..." : "Share / Export CSV"}
              loading={exporting}
              disabled={exporting || filteredProducts.length === 0}
              onPress={() => void handleExportCsv()}
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
    maxHeight: "88%",
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
    maxHeight: 480,
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
  filterPillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  filterPill: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    backgroundColor: Colors.surface,
  },
  filterPillActive: {
    borderColor: Colors.primaryBlue,
    backgroundColor: Colors.primaryBluePale,
  },
  filterText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  filterTextActive: {
    color: Colors.primaryBlue,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  metricCard: {
    flex: 1,
    minWidth: 120,
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  metricCardSpan: {
    flexBasis: "100%",
  },
  metricCaption: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  metricValue: {
    ...Typography.title,
    fontSize: 16,
    color: Colors.textPrimary,
    marginTop: 2,
  },
  tabRow: {
    flexDirection: "row",
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: 3,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: "center",
    borderRadius: Radius.sm,
  },
  tabBtnActive: {
    backgroundColor: Colors.surface,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  tabBtnText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: "500",
  },
  tabBtnTextActive: {
    color: Colors.textPrimary,
    fontWeight: "700",
  },
  tableList: {
    gap: Spacing.xs,
  },
  tableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  rowTitle: {
    ...Typography.body,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  rowSub: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  rowStock: {
    ...Typography.caption,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  rowPrice: {
    ...Typography.caption,
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
  moreNote: {
    ...Typography.caption,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: Spacing.xs,
  },
  emptyText: {
    ...Typography.body,
    color: Colors.textMuted,
    textAlign: "center",
    paddingVertical: Spacing.md,
  },
  previewBox: {
    backgroundColor: "#1e293b",
    padding: Spacing.sm,
    borderRadius: Radius.md,
  },
  monoText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#e2e8f0",
    lineHeight: 16,
  },
  footer: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
});
