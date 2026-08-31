import { Ionicons } from "@expo/vector-icons";
import { uuidv7 } from "@/src/core/ids";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { Colors } from "@/src/constants/colors";
import { Elevation } from "@/src/constants/elevation";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { database } from "@/src/database";
import type Product from "@/src/database/models/Product";
import { createProductBatch } from "@/src/features/inventory/batchService";
import { supabase } from "@/src/services/supabase";
import { enqueueChange } from "@/src/sync/enqueue";
import { synchronise } from "@/src/sync";
import { usingLaravel } from "@/src/core/api/config";

type ParsedProduct = {
  name: string;
  sku: string;
  barcode?: string;
  stock: number;
  sellPrice: number;
  costPrice?: number;
  reorderLevel: number;
  batchNumber?: string;
  expiryDate?: string;
  isValid: boolean;
  error?: string;
};

type SelectedFileInfo = {
  name: string;
  size?: number;
  uri: string;
};

type ImportProductModalProps = {
  visible: boolean;
  onClose: () => void;
  storeId: string;
  onSuccess: () => void;
  currencySymbol?: string;
};

const SAMPLE_CSV = `Product Name,SKU,Barcode,Stock,Sell Price,Cost Price,Reorder Level,Batch Number,Expiry Date
Milo 400g,MILO-400,012345678901,25,35.00,28.00,5,BAT-2026-01,2027-06-30
Peak Milk Tin,PEAK-TIN,012345678902,40,18.50,14.00,10,BAT-2026-02,2026-11-15
Sugar 1kg,SUGAR-1KG,012345678903,50,22.00,18.00,8,,
Ideal Milk 390g,IDEAL-390,,30,12.00,9.50,5,BAT-2026-03,2026-10-20`;

export function ImportProductModal({
  visible,
  onClose,
  storeId,
  onSuccess,
  currencySymbol = "₵",
}: ImportProductModalProps) {
  const [selectedFile, setSelectedFile] = useState<SelectedFileInfo | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedProduct[]>([]);
  const [readingFile, setReadingFile] = useState(false);
  const [importing, setImporting] = useState(false);

  function parseCsvContent(raw: string) {
    if (!raw.trim()) {
      setParsedRows([]);
      return;
    }

    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      Alert.alert("Empty or Invalid File", "The selected file must contain a header row and at least one product row.");
      setParsedRows([]);
      return;
    }

    // Process headers
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));
    const nameIdx = headers.findIndex((h) => h.includes("name") || h.includes("product") || h.includes("title"));
    const skuIdx = headers.findIndex((h) => h.includes("sku") || h.includes("code") || h.includes("item"));
    const barcodeIdx = headers.findIndex((h) => h.includes("barcode") || h.includes("upc") || h.includes("ean"));
    const stockIdx = headers.findIndex((h) => h.includes("stock") || h.includes("qty") || h.includes("quantity"));
    const sellPriceIdx = headers.findIndex((h) => h.includes("sell") || h.includes("price") || h.includes("retail"));
    const costPriceIdx = headers.findIndex((h) => h.includes("cost") || h.includes("buy") || h.includes("purchase"));
    const reorderIdx = headers.findIndex((h) => h.includes("reorder") || h.includes("min") || h.includes("threshold") || h.includes("low"));
    const batchIdx = headers.findIndex((h) => h.includes("batch") || h.includes("lot"));
    const expiryIdx = headers.findIndex((h) => h.includes("expir") || h.includes("exp"));

    const rows: ParsedProduct[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));
      if (parts.length === 0 || (parts.length === 1 && !parts[0])) continue;

      const name = nameIdx !== -1 ? parts[nameIdx] : parts[0] || "";
      const rawSku = skuIdx !== -1 ? parts[skuIdx] : parts[1] || "";
      const barcode = barcodeIdx !== -1 && parts[barcodeIdx] ? parts[barcodeIdx] : undefined;
      const rawStock = stockIdx !== -1 ? parts[stockIdx] : parts[2] || "0";
      const rawSell = sellPriceIdx !== -1 ? parts[sellPriceIdx] : parts[3] || "0";
      const rawCost = costPriceIdx !== -1 ? parts[costPriceIdx] : parts[4] || undefined;
      const rawReorder = reorderIdx !== -1 ? parts[reorderIdx] : parts[5] || "5";
      const rawBatch = batchIdx !== -1 ? parts[batchIdx] : undefined;
      const rawExpiry = expiryIdx !== -1 ? parts[expiryIdx] : undefined;

      const sku = rawSku.trim() || `SKU-${Date.now().toString().slice(-4)}-${i}`;
      const stock = Math.max(0, parseInt(rawStock.replace(/[^0-9.-]/g, ""), 10) || 0);
      const sellPrice = Math.max(0, parseFloat(rawSell.replace(/[^0-9.-]/g, "")) || 0);
      const costPrice = rawCost ? Math.max(0, parseFloat(rawCost.replace(/[^0-9.-]/g, "")) || 0) : undefined;
      const reorderLevel = Math.max(0, parseInt(rawReorder.replace(/[^0-9.-]/g, ""), 10) || 5);
      const batchNumber = rawBatch && rawBatch.trim() ? rawBatch.trim() : undefined;
      const expiryDate = rawExpiry && rawExpiry.trim() ? rawExpiry.trim() : undefined;

      const isValid = Boolean(name.trim()) && sellPrice > 0;
      const error = !name.trim()
        ? "Missing product name"
        : sellPrice <= 0
        ? "Sell price must be > 0"
        : undefined;

      rows.push({
        name: name.trim(),
        sku,
        barcode,
        stock,
        sellPrice,
        costPrice,
        reorderLevel,
        batchNumber,
        expiryDate,
        isValid,
        error,
      });
    }

    setParsedRows(rows);
  }

  async function handlePickFile() {
    try {
      setReadingFile(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "text/plain", "application/csv", "*/*"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setReadingFile(false);
        return;
      }

      const fileAsset = result.assets[0];
      setSelectedFile({
        name: fileAsset.name,
        size: fileAsset.size,
        uri: fileAsset.uri,
      });

      // Read file content
      let content = "";
      if (Platform.OS === "web") {
        const response = await fetch(fileAsset.uri);
        content = await response.text();
      } else {
        content = await FileSystem.readAsStringAsync(fileAsset.uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      parseCsvContent(content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not read file";
      Alert.alert("File Selection Error", msg);
    } finally {
      setReadingFile(false);
    }
  }

  async function handleDownloadTemplate() {
    try {
      const fileUri = `${FileSystem.cacheDirectory || ""}omnipos_product_import_template.csv`;
      await FileSystem.writeAsStringAsync(fileUri, SAMPLE_CSV, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "text/csv",
          dialogTitle: "Share / Save Import Template (With Batch & Expiry)",
          UTI: "public.comma-separated-values-text",
        });
      } else {
        Alert.alert("Template Generated", "Template CSV file is ready.");
      }
    } catch {
      Alert.alert("Error", "Could not generate sample CSV template.");
    }
  }

  function handleClearFile() {
    setSelectedFile(null);
    setParsedRows([]);
  }

  async function handleExecuteImport() {
    const validRows = parsedRows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      Alert.alert("No Valid Products", "There are no valid products to import. Please check file content.");
      return;
    }

    if (!storeId) {
      Alert.alert("Store Missing", "Active store is not selected.");
      return;
    }

    setImporting(true);
    const now = Date.now();

    try {
      const net = await NetInfo.fetch();
      const isOnline = Boolean(net.isConnected);

      await database.write(async () => {
        const prodCol = database.get<Product>("products");
        for (const item of validRows) {
          const productId = uuidv7();
          await prodCol.create((rec) => {
            rec._raw.id = productId;
            rec.storeId = storeId;
            rec.remoteId = productId;
            rec.name = item.name;
            rec.sku = item.sku;
            rec.barcode = item.barcode;
            rec.stock = item.stock;
            rec.sellPrice = item.sellPrice;
            rec.costPrice = item.costPrice;
            rec.reorderLevel = item.reorderLevel;
            rec.updatedAt = now;
            rec.dirty = true;
          });

          // Create ProductBatch if batchNumber or expiryDate is specified or if stock > 0
          if (item.batchNumber || item.expiryDate) {
            void createProductBatch({
              storeId,
              productId,
              batchNumber: item.batchNumber || `BATCH-${Date.now().toString().slice(-4)}`,
              quantity: item.stock,
              costPrice: item.costPrice,
              expiryDate: item.expiryDate,
            });
          }

          // Queue / direct sync product
          const payload = {
            id: productId,
            store_id: storeId,
            name: item.name,
            sku: item.sku,
            barcode: item.barcode ?? null,
            stock: item.stock,
            sell_price: item.sellPrice,
            cost_price: item.costPrice ?? null,
            reorder_level: item.reorderLevel,
            updated_at: new Date(now).toISOString(),
          };

          if (isOnline) {
            try {
              // Supabase only: the queued operation below is the sole path
              // to the Laravel server, and writing to both would split the
              // catalogue across two backends.
              if (!usingLaravel) {
                void supabase.from("products").upsert(payload, { onConflict: "id" });
              }
            } catch {
              // fallback to queue
            }
          }

          void enqueueChange({
            storeId,
            entity: "products",
            operation: "upsert",
            recordId: productId,
            payload,
          });
        }
      });

      void synchronise(storeId);

      Alert.alert(
        "Import Complete",
        `Successfully imported ${validRows.length} product(s) with batch and expiry tracking.`
      );
      handleClearFile();
      onSuccess();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to import products";
      Alert.alert("Import Error", msg);
    } finally {
      setImporting(false);
    }
  }

  const validCount = parsedRows.filter((r) => r.isValid).length;
  const invalidCount = parsedRows.filter((r) => !r.isValid).length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={styles.headerIconWrap}>
                <Ionicons name="document-attach-outline" size={20} color={Colors.primaryBlue} />
              </View>
              <View>
                <Text style={styles.title}>Import Products File</Text>
                <Text style={styles.subtitle}>Select CSV file with batch & expiry info</Text>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={Colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
            {/* Template Download Shortcut */}
            <View style={styles.templateBox}>
              <View style={{ flex: 1 }}>
                <Text style={styles.templateTitle}>CSV Template (With Batch & Expiry)</Text>
                <Text style={styles.templateSubtitle}>
                  Includes: Name, SKU, Barcode, Stock, Sell Price, Cost, Reorder, Batch #, Expiry Date
                </Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.downloadBtn, pressed && { opacity: 0.8 }]}
                onPress={handleDownloadTemplate}
              >
                <Ionicons name="download-outline" size={15} color={Colors.primaryBlue} />
                <Text style={styles.downloadBtnText}>Get Template</Text>
              </Pressable>
            </View>

            {/* File Picker Card */}
            {!selectedFile ? (
              <Pressable
                style={({ pressed }) => [
                  styles.pickerCard,
                  pressed && styles.pickerCardPressed,
                ]}
                onPress={handlePickFile}
                disabled={readingFile}
              >
                {readingFile ? (
                  <ActivityIndicator size="small" color={Colors.primaryBlue} />
                ) : (
                  <View style={styles.pickerIconCircle}>
                    <Ionicons name="cloud-upload-outline" size={32} color={Colors.primaryBlue} />
                  </View>
                )}
                <Text style={styles.pickerTitle}>
                  {readingFile ? "Reading File..." : "Choose CSV File to Upload"}
                </Text>
                <Text style={styles.pickerSubtitle}>
                  Tap to browse and select a .csv file from your device
                </Text>
              </Pressable>
            ) : (
              <View style={styles.selectedFileBox}>
                <View style={styles.fileIconWrap}>
                  <Ionicons name="document-text" size={24} color={Colors.primaryBlue} />
                </View>
                <View style={styles.fileDetails}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {selectedFile.name}
                  </Text>
                  <Text style={styles.fileMeta}>
                    {selectedFile.size ? `${(selectedFile.size / 1024).toFixed(1)} KB · ` : ""}
                    {parsedRows.length} item(s) detected
                  </Text>
                </View>
                <Pressable onPress={handlePickFile} hitSlop={8} style={styles.changeFileBtn}>
                  <Text style={styles.changeFileText}>Change</Text>
                </Pressable>
                <Pressable onPress={handleClearFile} hitSlop={8} style={styles.removeFileBtn}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </Pressable>
              </View>
            )}

            {/* Parsed Rows Preview */}
            {parsedRows.length > 0 ? (
              <View style={styles.previewSection}>
                <View style={styles.previewHeader}>
                  <Text style={styles.previewTitle}>
                    File Preview ({validCount} valid{invalidCount > 0 ? `, ${invalidCount} invalid` : ""})
                  </Text>
                  {invalidCount > 0 ? (
                    <Text style={styles.invalidBadge}>Fix invalid rows</Text>
                  ) : (
                    <Text style={styles.validBadge}>Ready to import</Text>
                  )}
                </View>

                <View style={styles.previewList}>
                  {parsedRows.map((row, idx) => (
                    <View
                      key={idx}
                      style={[
                        styles.previewCard,
                        !row.isValid && styles.previewCardInvalid,
                      ]}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.previewName}>{row.name || "Untitled Product"}</Text>
                        <Text style={styles.previewMeta}>
                          SKU: {row.sku} · Qty: {row.stock}
                        </Text>
                        <View style={styles.batchTagsRow}>
                          {row.batchNumber ? (
                            <View style={styles.batchTag}>
                              <Ionicons name="layers-outline" size={10} color={Colors.primaryBlue} />
                              <Text style={styles.batchTagText}>Batch: {row.batchNumber}</Text>
                            </View>
                          ) : null}
                          {row.expiryDate ? (
                            <View style={styles.expiryTag}>
                              <Ionicons name="time-outline" size={10} color="#d97706" />
                              <Text style={styles.expiryTagText}>Exp: {row.expiryDate}</Text>
                            </View>
                          ) : null}
                        </View>
                        {row.error ? (
                          <Text style={styles.rowErrorText}>⚠️ {row.error}</Text>
                        ) : null}
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={styles.previewPrice}>
                          {currencySymbol} {row.sellPrice.toFixed(2)}
                        </Text>
                        {row.costPrice != null ? (
                          <Text style={styles.previewCost}>
                            Cost: {currencySymbol} {row.costPrice.toFixed(2)}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Action Buttons */}
            <View style={styles.actionsRow}>
              <Pressable style={styles.cancelBtn} onPress={onClose} disabled={importing}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.importBtn,
                  (validCount === 0 || importing) && { opacity: 0.6 },
                ]}
                onPress={() => void handleExecuteImport()}
                disabled={validCount === 0 || importing}
              >
                {importing ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Ionicons name="cloud-upload" size={18} color={Colors.white} />
                )}
                <Text style={styles.importBtnText}>
                  {importing
                    ? "Importing..."
                    : validCount > 0
                    ? `Import (${validCount}) Products`
                    : "Import Products"}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    justifyContent: "flex-end",
  },
  container: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.md,
    gap: Spacing.sm,
    maxHeight: "90%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  headerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    marginVertical: Spacing.xs,
  },
  templateBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: Radius.card,
    padding: Spacing.sm + 2,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginVertical: Spacing.xs,
    gap: Spacing.sm,
  },
  templateTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  templateSubtitle: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primaryBluePale,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  downloadBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  pickerCard: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    borderRadius: Radius.card,
    borderWidth: 2,
    borderColor: "#cbd5e1",
    borderStyle: "dashed",
    backgroundColor: Colors.background,
    marginVertical: Spacing.sm,
    gap: 6,
  },
  pickerCardPressed: {
    backgroundColor: Colors.primaryBluePale,
    borderColor: Colors.primaryBlue,
  },
  pickerIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  pickerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  pickerSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: "center",
  },
  selectedFileBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: Radius.card,
    padding: Spacing.sm + 2,
    borderWidth: 1,
    borderColor: Colors.primaryBlue,
    marginVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  fileIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  fileDetails: {
    flex: 1,
    gap: 2,
  },
  fileName: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  fileMeta: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  changeFileBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.pill,
  },
  changeFileText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  removeFileBtn: {
    padding: 6,
  },
  previewSection: {
    marginTop: Spacing.sm,
    gap: 6,
  },
  previewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
    textTransform: "uppercase",
  },
  validBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.success,
  },
  invalidBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.danger,
  },
  previewList: {
    gap: 6,
  },
  previewCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.sm + 2,
    borderRadius: Radius.card,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  previewCardInvalid: {
    borderColor: "#fecdd3",
    backgroundColor: "#fff1f2",
  },
  previewName: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  previewMeta: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  batchTagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 2,
  },
  batchTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: Colors.primaryBluePale,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  batchTagText: {
    fontSize: 10,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  expiryTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#fef3c7",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  expiryTagText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#d97706",
  },
  rowErrorText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.danger,
    marginTop: 2,
  },
  previewPrice: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
  previewCost: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 1,
  },
  actionsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  importBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryBlue,
  },
  importBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.white,
  },
});
