import { Ionicons } from "@expo/vector-icons";
import { Q } from "@nozbe/watermelondb";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { ProductCard } from "@/src/components/molecules/ProductCard";
import { BarcodeScanner } from "@/src/components/organisms/BarcodeScanner";
import { ExportPrintModal, type ExportProductItem } from "@/src/components/organisms/ExportPrintModal";
import { Colors } from "@/src/constants/colors";
import { Elevation } from "@/src/constants/elevation";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { database } from "@/src/database";
import type Product from "@/src/database/models/Product";
import type ProductBatch from "@/src/database/models/ProductBatch";
import type SyncQueueItem from "@/src/database/models/SyncQueueItem";
import { calculateExpiryStatus, getAllStoreBatches } from "@/src/features/inventory/batchService";
import { resolveProductImageUrl } from "@/src/services/storage";
import { useSettingsStore } from "@/src/store/settingsStore";
import { runSyncCycle } from "@/src/sync/syncEngine";
import { useStoreSlice } from "@/src/store/storeSlice";

type InventoryRow = {
  id: string;
  name: string;
  sku: string;
  stockCount: number;
  lowStockThreshold: number;
  sellPrice: number;
  costPrice?: number | null;
  imageUrl?: string | null;
  expiryStatus?: "good" | "expiring_soon" | "expired" | "no_expiry";
  expiryLabel?: string;
  expiryDate?: string | null;
};

type StockFilterType = "all" | "in_stock" | "low" | "out" | "expiring_soon" | "expired";

const FILTER_OPTIONS: {
  key: StockFilterType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
}[] = [
  { key: "all", label: "All Products", icon: "cube-outline" },
  { key: "in_stock", label: "In Stock", icon: "checkmark-circle-outline", color: "#16a34a" },
  { key: "low", label: "Low Stock", icon: "warning-outline", color: "#d97706" },
  { key: "out", label: "Out of Stock", icon: "close-circle-outline", color: "#dc2626" },
  { key: "expiring_soon", label: "Expiring Soon (<30d)", icon: "time-outline", color: "#d97706" },
  { key: "expired", label: "Expired", icon: "alert-circle-outline", color: "#dc2626" },
];

export default function InventoryScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const shopName = useSettingsStore((s) => s.shopName);
  const currency = useSettingsStore((s) => s.currency);
  const currencySymbol = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";

  const [query, setQuery] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [stockFilter, setStockFilter] = useState<StockFilterType>("all");
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [products, setProducts] = useState<InventoryRow[]>([]);
  const [exportModalVisible, setExportModalVisible] = useState(false);

  // Expiry metrics
  const [expiredCount, setExpiredCount] = useState(0);
  const [expiringSoonCount, setExpiringSoonCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      async function loadInventory() {
        if (!activeStoreId) {
          if (mounted) {
            setProducts([]);
            setExpiredCount(0);
            setExpiringSoonCount(0);
          }
          return;
        }
        await runSyncCycle(activeStoreId);
        const rows = await database
          .get<Product>("products")
          .query(Q.where("store_id", activeStoreId))
          .fetch();
        const queueRows = await database
          .get<SyncQueueItem>("sync_queue")
          .query(Q.where("store_id", activeStoreId), Q.where("entity", "products"), Q.where("operation", "upsert"))
          .fetch();
        const batches = await getAllStoreBatches(activeStoreId);

        // Group batch expiry by productId
        const batchMapByProduct = new Map<string, { status: "good" | "expiring_soon" | "expired" | "no_expiry"; label: string; date: string }>();
        let expCount = 0;
        let soonCount = 0;

        batches.forEach((b) => {
          if (!b.expiryDate || (b.quantity ?? 0) <= 0) return;
          const info = calculateExpiryStatus(b.expiryDate);
          if (info.status === "expired") expCount++;
          if (info.status === "expiring_soon") soonCount++;

          const existing = batchMapByProduct.get(b.productId);
          if (!existing || info.status === "expired" || (info.status === "expiring_soon" && existing.status !== "expired")) {
            batchMapByProduct.set(b.productId, {
              status: info.status,
              label: info.label,
              date: b.expiryDate,
            });
          }
        });

        if (mounted) {
          setExpiredCount(expCount);
          setExpiringSoonCount(soonCount);
        }

        const imageBySku = new Map<string, string>();
        queueRows.forEach((row) => {
          try {
            const payload = JSON.parse(row.payload) as {
              sku?: string;
              image_url?: string | null;
              local_image_uri?: string | null;
            };
            if (!payload.sku) return;
            const pendingImage = payload.local_image_uri ?? payload.image_url;
            if (pendingImage) {
              imageBySku.set(payload.sku, pendingImage);
            }
          } catch {
            // ignore malformed queue payload
          }
        });
        if (!mounted) return;
        const nextProducts = await Promise.all(
          rows.map(async (p) => {
            const rawImage = imageBySku.get(p.sku) ?? p.imageUrl ?? null;
            const batchInfo = batchMapByProduct.get(p.id);

            return {
              id: p.id,
              name: p.name,
              sku: p.sku,
              stockCount: Number(p.stock ?? 0),
              lowStockThreshold: Number(p.reorderLevel ?? 5),
              sellPrice: Number(p.sellPrice ?? 0),
              costPrice: p.costPrice,
              imageUrl: await resolveProductImageUrl(rawImage),
              expiryStatus: batchInfo?.status ?? "no_expiry",
              expiryLabel: batchInfo?.label,
              expiryDate: batchInfo?.date,
            };
          }),
        );
        setProducts(nextProducts);
      }
      void loadInventory();
      return () => {
        mounted = false;
      };
    }, [activeStoreId]),
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (stockFilter === "in_stock" && p.stockCount <= 0) return false;
      if (stockFilter === "out" && p.stockCount > 0) return false;
      if (stockFilter === "low" && !(p.stockCount > 0 && p.stockCount <= p.lowStockThreshold)) return false;
      if (stockFilter === "expiring_soon" && p.expiryStatus !== "expiring_soon") return false;
      if (stockFilter === "expired" && p.expiryStatus !== "expired") return false;

      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        String(p.stockCount).includes(q)
      );
    });
  }, [products, query, stockFilter]);

  const exportProductList: ExportProductItem[] = useMemo(() => {
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      stock: p.stockCount,
      reorderLevel: p.lowStockThreshold,
      sellPrice: p.sellPrice,
      costPrice: p.costPrice,
      expiryDate: p.expiryDate,
      expiryStatus: p.expiryStatus,
    }));
  }, [products]);

  return (
    <AppScrollScreen title="Inventory" subtitle="Stock overview, batch tracking & exports.">
      {/* Expiry Alerts Banner */}
      {expiredCount > 0 || expiringSoonCount > 0 ? (
        <View style={styles.alertBanner}>
          <View style={styles.alertIconWrap}>
            <Ionicons name="warning-outline" size={22} color="#dc2626" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.alertTitle}>Expiry Attention Needed</Text>
            <Text style={styles.alertSubtitle}>
              {expiredCount > 0 ? `${expiredCount} expired batch(es)` : ""}
              {expiredCount > 0 && expiringSoonCount > 0 ? " · " : ""}
              {expiringSoonCount > 0 ? `${expiringSoonCount} expiring soon (<30d)` : ""}
            </Text>
          </View>
          <Pressable
            style={styles.alertActionBtn}
            onPress={() => setStockFilter(expiredCount > 0 ? "expired" : "expiring_soon")}
          >
            <Text style={styles.alertActionText}>View</Text>
          </Pressable>
        </View>
      ) : null}

      <SectionCard>
        <TextInput
          label="Search"
          value={query}
          onChangeText={setQuery}
          placeholder="SKU, name, or barcode"
          leftIcon={<Ionicons name="search" size={20} color={Colors.textMuted} />}
          rightIcon={
            <Pressable onPress={() => setShowScanner((v) => !v)} hitSlop={10}>
              <Ionicons
                name={showScanner ? "close-circle-outline" : "scan-outline"}
                size={20}
                color={Colors.primaryBlue}
              />
            </Pressable>
          }
        />
        {showScanner ? (
          <BarcodeScanner
            label="Scan product code to search inventory"
            onScan={(payload) => {
              setQuery(payload);
              setShowScanner(false);
            }}
          />
        ) : null}

        {/* Filter Dropdown */}
        <View style={styles.filterDropdownSection}>
          <Text style={styles.filterSectionLabel}>Filter By Status</Text>
          <Pressable
            style={styles.filterDropdownTrigger}
            onPress={() => setFilterDropdownOpen((v) => !v)}
          >
            <View style={styles.filterDropdownLeft}>
              <Ionicons
                name={
                  FILTER_OPTIONS.find((f) => f.key === stockFilter)?.icon || "filter-outline"
                }
                size={18}
                color={
                  FILTER_OPTIONS.find((f) => f.key === stockFilter)?.color || Colors.primaryBlue
                }
              />
              <Text style={styles.filterDropdownTriggerText}>
                {FILTER_OPTIONS.find((f) => f.key === stockFilter)?.label ?? "All Products"}
              </Text>
            </View>
            <View style={styles.filterDropdownRight}>
              <View style={styles.filterCountBadge}>
                <Text style={styles.filterCountText}>{rows.length}</Text>
              </View>
              <Ionicons
                name={filterDropdownOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color={Colors.textMuted}
              />
            </View>
          </Pressable>

          {filterDropdownOpen ? (
            <View style={styles.filterDropdownMenu}>
              {FILTER_OPTIONS.map((opt) => {
                const isSelected = stockFilter === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    style={[styles.filterDropdownItem, isSelected && styles.filterDropdownItemActive]}
                    onPress={() => {
                      setStockFilter(opt.key);
                      setFilterDropdownOpen(false);
                    }}
                  >
                    <View style={styles.filterDropdownItemLeft}>
                      <Ionicons
                        name={opt.icon}
                        size={18}
                        color={opt.color || (isSelected ? Colors.primaryBlue : Colors.textMuted)}
                      />
                      <Text
                        style={[
                          styles.filterDropdownItemText,
                          isSelected && styles.filterDropdownItemTextActive,
                          opt.key === "expired" && styles.filterDropdownExpiredText,
                        ]}
                      >
                        {opt.label}
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
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Products ({rows.length})</Text>

        <View style={styles.list}>
          {rows.map((p) => (
            <ProductCard
              key={p.id}
              imageUrl={p.imageUrl}
              name={p.name}
              stockCount={p.stockCount}
              lowStockThreshold={p.lowStockThreshold}
              price={p.sellPrice}
              expiryStatus={p.expiryStatus}
              expiryLabel={p.expiryLabel}
              onPress={() => router.push(`/product/edit/${p.id}`)}
            />
          ))}
          {rows.length === 0 ? <Text style={styles.empty}>No products match your search/filter.</Text> : null}
        </View>

        {/* Action Buttons Below Products List */}
        <View style={styles.bottomActionsRow}>
          <PrimaryButton
            label="Export / Print"
            variant="outline"
            fullWidth={false}
            style={styles.exportBtn}
            onPress={() => setExportModalVisible(true)}
          />
          <PrimaryButton
            label="+ Add Product"
            variant="primary"
            fullWidth={false}
            style={styles.addBtn}
            onPress={() => router.push("/product/add")}
          />
        </View>
      </SectionCard>

      {/* Export / Print Modal */}
      <ExportPrintModal
        visible={exportModalVisible}
        onClose={() => setExportModalVisible(false)}
        products={exportProductList}
        currencySymbol={currencySymbol}
        storeName={shopName}
      />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  alertBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef2f2",
    borderRadius: Radius.lg,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: "#fecaca",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  alertIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
  },
  alertTitle: {
    ...Typography.body,
    fontWeight: "700",
    color: "#b91c1c",
    fontSize: 14,
  },
  alertSubtitle: {
    ...Typography.caption,
    color: "#dc2626",
    fontSize: 12,
  },
  alertActionBtn: {
    backgroundColor: "#dc2626",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  alertActionText: {
    color: Colors.textWhite,
    fontSize: 12,
    fontWeight: "700",
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    flex: 1,
  },
  bottomActionsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
    justifyContent: "flex-end",
  },
  exportBtn: {
    flex: 1,
    borderColor: Colors.border,
  },
  addBtn: {
    flex: 1,
  },
  list: {
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  filterDropdownSection: {
    marginTop: Spacing.xs,
    gap: 4,
  },
  filterSectionLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  filterDropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 46,
  },
  filterDropdownLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  filterDropdownTriggerText: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: "600",
  },
  filterDropdownRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  filterCountBadge: {
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  filterCountText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  filterDropdownMenu: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    marginTop: 4,
    ...Elevation.card,
  },
  filterDropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.divider,
  },
  filterDropdownItemActive: {
    backgroundColor: Colors.primaryBluePale,
  },
  filterDropdownItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  filterDropdownItemText: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: "500",
  },
  filterDropdownItemTextActive: {
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
  filterDropdownExpiredText: {
    color: Colors.danger,
  },
  empty: {
    marginVertical: Spacing.md,
    color: Colors.textMuted,
    textAlign: "center",
  },
});

