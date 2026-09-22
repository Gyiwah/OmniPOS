import { Ionicons } from "@expo/vector-icons";
import { Q } from "@nozbe/watermelondb";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { TextInput } from "@/src/components/atoms/TextInput";
import { ProductCard } from "@/src/components/molecules/ProductCard";
import { BarcodeScanner } from "@/src/components/organisms/BarcodeScanner";
import { ExportPrintModal, type ExportProductItem } from "@/src/components/organisms/ExportPrintModal";
import { ImportProductModal } from "@/src/components/organisms/ImportProductModal";
import { Colors } from "@/src/constants/colors";
import { Elevation } from "@/src/constants/elevation";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { database } from "@/src/database";
import type Product from "@/src/database/models/Product";
import type SyncQueueItem from "@/src/database/models/SyncQueueItem";
import { calculateExpiryStatus, getAllStoreBatches } from "@/src/features/inventory/batchService";
import { imageAuthHeaders, resolveProductImageUrl } from "@/src/services/storage";
import { useSettingsStore, UNNAMED_STORE } from "@/src/store/settingsStore";
import { synchronise } from "@/src/sync";
import { useAuthStore } from "@/src/store/authStore";
import { useStoreSlice } from "@/src/store/storeSlice";
import { canEditCatalogue } from "@/src/utils/permissions";

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

type StockFilterType = "all" | "in_stock" | "low" | "expiring_soon" | "expired" | "out";

const FILTER_OPTIONS: {
  key: StockFilterType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
}[] = [
    { key: "all", label: "All Products", icon: "cube-outline" },
    { key: "in_stock", label: "In Stock", icon: "checkmark-circle-outline", color: "#16a34a" },
    { key: "low", label: "Low Stock", icon: "warning-outline", color: "#d97706" },
    { key: "expiring_soon", label: "Expiring Soon (<30d)", icon: "time-outline", color: "#d97706" },
    { key: "expired", label: "Expired", icon: "alert-circle-outline", color: "#dc2626" },
    { key: "out", label: "Out of Stock", icon: "close-circle-outline", color: "#dc2626" },
  ];

export default function InventoryScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const role = useAuthStore((s) => s.role);
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);
  const mayEditCatalogue = canEditCatalogue(isSuperAdmin ? "super_admin" : role);
  const shopName = useSettingsStore((s) => s.shopName);
  const currency = useSettingsStore((s) => s.currency);
  const currencySymbol = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";

  const [query, setQuery] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [stockFilter, setStockFilter] = useState<StockFilterType>("all");
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [products, setProducts] = useState<InventoryRow[]>([]);
  const [imageHeaders, setImageHeaders] = useState<Record<string, string>>({});
  const [exportModalVisible, setExportModalVisible] = useState(false);

  // Add / Import Options Popup Modal State
  const [addMenuVisible, setAddMenuVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);

  // Expiry metrics
  const [expiredCount, setExpiredCount] = useState(0);
  const [expiringSoonCount, setExpiringSoonCount] = useState(0);

  const loadInventory = useCallback(async () => {
    if (!activeStoreId) {
      setProducts([]);
      setImageHeaders({});
      setExpiredCount(0);
      setExpiringSoonCount(0);
      return;
    }
    const headers = await imageAuthHeaders();
    setImageHeaders(headers);
    // 1. Fetch local WatermelonDB products immediately (instant offline access)
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

    setExpiredCount(expCount);
    setExpiringSoonCount(soonCount);

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
  }, [activeStoreId]);

  useFocusEffect(
    useCallback(() => {
      void loadInventory();
    }, [loadInventory]),
  );

  // Compute counts for filter dropdown options
  const counts = useMemo(() => {
    let inStock = 0;
    let low = 0;
    let out = 0;
    let expiring = 0;
    let expired = 0;

    products.forEach((p) => {
      if (p.stockCount > 0) inStock++;
      if (p.stockCount <= 0) out++;
      if (p.stockCount > 0 && p.stockCount <= p.lowStockThreshold) low++;
      if (p.expiryStatus === "expiring_soon") expiring++;
      if (p.expiryStatus === "expired") expired++;
    });

    return {
      all: products.length,
      in_stock: inStock,
      low,
      out,
      expiring_soon: expiring,
      expired,
    };
  }, [products]);

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

  const selectedOption = FILTER_OPTIONS.find((f) => f.key === stockFilter) ?? FILTER_OPTIONS[0];

  if (!mayEditCatalogue) {
    return (
      <AppScrollScreen title="Inventory" subtitle="Product Catalogue">
        <SectionCard style={{ alignItems: "center", paddingVertical: Spacing.xl, gap: Spacing.sm }}>
          <Ionicons name="lock-closed-outline" size={48} color={Colors.danger} />
          <Text style={{ fontSize: 17, fontWeight: "800", color: Colors.textPrimary }}>
            Access Restricted
          </Text>
          <Text style={{ fontSize: 13, color: Colors.textMuted, textAlign: "center", paddingHorizontal: Spacing.lg }}>
            Cashiers are not authorized to view or edit the product inventory.
          </Text>
        </SectionCard>
      </AppScrollScreen>
    );
  }

  return (
    <AppScrollScreen
      title="Inventory"
      subtitle="Stock catalog, batch tracking & exports"
      right={
        <View style={styles.headerIconsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Export or Print Inventory"
            style={({ pressed }) => [styles.headerActionBtn, styles.exportIconBtn, pressed && styles.headerIconBtnPressed]}
            onPress={() => setExportModalVisible(true)}
          >
            <Ionicons name="print-outline" size={16} color={Colors.primaryBlue} />
            <Text style={styles.exportActionText}>Export/Print</Text>
          </Pressable>
          {mayEditCatalogue ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add or Import Product"
              style={({ pressed }) => [styles.headerActionBtn, styles.addIconBtn, pressed && styles.headerIconBtnPressed]}
              onPress={() => setAddMenuVisible(true)}
            >
              <Ionicons name="add" size={18} color={Colors.white} />
              <Text style={styles.addActionText}>Add Product</Text>
            </Pressable>
          ) : null}
        </View>
      }
    >
      {/* Expiry Alerts Banner */}
      {expiredCount > 0 || expiringSoonCount > 0 ? (
        <View style={styles.alertBanner}>
          <View style={styles.alertIconWrap}>
            <Ionicons name="warning-outline" size={20} color="#dc2626" />
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

      {/* Search & Filter Section */}
      <SectionCard>
        <TextInput
          label="Search Products"
          value={query}
          onChangeText={setQuery}
          placeholder="Search by SKU, name, or barcode..."
          leftIcon={<Ionicons name="search" size={18} color={Colors.textMuted} />}
          rightIcon={
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {query ? (
                <Pressable onPress={() => setQuery("")} hitSlop={10}>
                  <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
                </Pressable>
              ) : null}
              <Pressable onPress={() => setShowScanner((v) => !v)} hitSlop={10}>
                <Ionicons
                  name={showScanner ? "close-circle-outline" : "scan-outline"}
                  size={20}
                  color={Colors.primaryBlue}
                />
              </Pressable>
            </View>
          }
        />
        {showScanner ? (
          <BarcodeScanner
            label="Scan product barcode to filter inventory"
            onScan={(payload) => {
              setQuery(payload);
              setShowScanner(false);
            }}
          />
        ) : null}

        {/* Status Filter Dropdown */}
        <View style={styles.filterDropdownSection}>
          <Text style={styles.filterSectionLabel}>Filter By Status</Text>
          <Pressable
            style={[styles.filterDropdownTrigger, filterDropdownOpen && styles.filterDropdownTriggerActive]}
            onPress={() => setFilterDropdownOpen((v) => !v)}
          >
            <View style={styles.filterDropdownLeft}>
              <Ionicons
                name={selectedOption.icon}
                size={18}
                color={selectedOption.color || Colors.primaryBlue}
              />
              <Text style={styles.filterDropdownTriggerText}>
                {selectedOption.label}
              </Text>
            </View>
            <View style={styles.filterDropdownRight}>
              <View style={styles.filterCountBadge}>
                <Text style={styles.filterCountText}>{counts[stockFilter]}</Text>
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
                const optCount = counts[opt.key];
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
                    <View style={styles.filterDropdownItemRight}>
                      <View style={[styles.filterCountBadge, isSelected && styles.filterCountBadgeActive]}>
                        <Text style={[styles.filterCountText, isSelected && styles.filterCountTextActive]}>
                          {optCount}
                        </Text>
                      </View>
                      {isSelected ? (
                        <Ionicons name="checkmark" size={18} color={Colors.primaryBlue} />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      </SectionCard>

      {/* Product List */}
      <SectionCard>
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>
            Products ({rows.length})
          </Text>
          <Text style={styles.filterActiveLabel}>
            {selectedOption.label}
          </Text>
        </View>

        <View style={styles.list}>
          {rows.map((p) => (
            <ProductCard
              key={p.id}
              imageUrl={p.imageUrl}
              imageHeaders={imageHeaders}
              name={p.name}
              sku={p.sku}
              stockCount={p.stockCount}
              lowStockThreshold={p.lowStockThreshold}
              price={p.sellPrice}
              costPrice={p.costPrice}
              currencySymbol={currencySymbol}
              expiryStatus={p.expiryStatus}
              expiryLabel={p.expiryLabel}
              onPress={() => router.push(`/product/edit/${p.id}`)}
            />
          ))}
          {rows.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="search-outline" size={36} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No matching products</Text>
              <Text style={styles.emptySubtitle}>
                {query
                  ? `No products match "${query}".`
                  : "No products found in this filter category."}
              </Text>
            </View>
          ) : null}
        </View>
      </SectionCard>

      {/* Export / Print Modal */}
      <ExportPrintModal
        visible={exportModalVisible}
        onClose={() => setExportModalVisible(false)}
        products={exportProductList}
        currencySymbol={currencySymbol}
        storeName={shopName || UNNAMED_STORE}
      />

      {/* Add Product Options Pop-up Modal */}
      <Modal
        visible={addMenuVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setAddMenuVisible(false)}
      >
        <Pressable style={styles.popupBackdrop} onPress={() => setAddMenuVisible(false)}>
          <View style={styles.popupCard}>
            <View style={styles.popupHeader}>
              <Text style={styles.popupTitle}>Product Options</Text>
              <Pressable onPress={() => setAddMenuVisible(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={Colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.popupOptionsList}>
              {/* Option A: Add Product */}
              <Pressable
                style={({ pressed }) => [styles.popupOptionItem, pressed && styles.popupOptionPressed]}
                onPress={() => {
                  setAddMenuVisible(false);
                  router.push("/product/add");
                }}
              >
                <View style={[styles.popupOptionIconWrap, { backgroundColor: Colors.primaryBluePale }]}>
                  <Ionicons name="add-circle-outline" size={22} color={Colors.primaryBlue} />
                </View>
                <View style={styles.popupOptionBody}>
                  <Text style={styles.popupOptionTitle}>Add Product</Text>
                  <Text style={styles.popupOptionSubtitle}>Enter product details and stock manually</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </Pressable>

              {/* Option B: Import Product */}
              <Pressable
                style={({ pressed }) => [styles.popupOptionItem, pressed && styles.popupOptionPressed]}
                onPress={() => {
                  setAddMenuVisible(false);
                  setImportModalVisible(true);
                }}
              >
                <View style={[styles.popupOptionIconWrap, { backgroundColor: "#f0fdf4" }]}>
                  <Ionicons name="cloud-upload-outline" size={22} color="#16a34a" />
                </View>
                <View style={styles.popupOptionBody}>
                  <Text style={styles.popupOptionTitle}>Import Product</Text>
                  <Text style={styles.popupOptionSubtitle}>Bulk upload multiple products via CSV</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Import Product Modal */}
      {activeStoreId ? (
        <ImportProductModal
          visible={importModalVisible}
          onClose={() => setImportModalVisible(false)}
          storeId={activeStoreId}
          onSuccess={() => void loadInventory()}
          currencySymbol={currencySymbol}
        />
      ) : null}
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  headerIconsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  exportIconBtn: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  exportActionText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  addIconBtn: {
    backgroundColor: Colors.primaryBlue,
  },
  addActionText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.white,
  },
  headerIconBtnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.95 }],
  },
  alertBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef2f2",
    borderRadius: Radius.lg,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: "#fecaca",
    gap: Spacing.sm,
  },
  alertIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
  },
  alertTitle: {
    ...Typography.body,
    fontWeight: "700",
    color: "#b91c1c",
    fontSize: 13,
  },
  alertSubtitle: {
    ...Typography.caption,
    color: "#dc2626",
    fontSize: 11,
  },
  alertActionBtn: {
    backgroundColor: "#dc2626",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  alertActionText: {
    color: Colors.textWhite,
    fontSize: 11,
    fontWeight: "700",
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
    borderColor: "#e2e8f0",
    minHeight: 46,
  },
  filterDropdownTriggerActive: {
    borderColor: Colors.primaryBlue,
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
    backgroundColor: "#e2e8f0",
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  filterCountBadgeActive: {
    backgroundColor: Colors.primaryBluePale,
  },
  filterCountText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  filterCountTextActive: {
    color: Colors.primaryBlue,
  },
  filterDropdownMenu: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: "#e2e8f0",
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
    flex: 1,
  },
  filterDropdownItemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
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
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  sectionTitle: {
    ...Typography.title,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  filterActiveLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.primaryBlue,
  },
  list: {
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  emptyWrap: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
    gap: Spacing.xs,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: "center",
  },
  popupBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  popupCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.md,
    gap: Spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  popupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  popupTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  popupOptionsList: {
    gap: Spacing.xs,
    marginTop: 4,
  },
  popupOptionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.sm + 2,
    borderRadius: Radius.card,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  popupOptionPressed: {
    opacity: 0.85,
    backgroundColor: Colors.primaryBluePale,
    borderColor: Colors.primaryBlue,
  },
  popupOptionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  popupOptionBody: {
    flex: 1,
    gap: 2,
  },
  popupOptionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  popupOptionSubtitle: {
    fontSize: 11,
    color: Colors.textMuted,
  },
});
