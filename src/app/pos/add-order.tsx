import Ionicons from "@expo/vector-icons/Ionicons";
import { Q } from "@nozbe/watermelondb";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { BarcodeScanner } from "@/src/components/organisms/BarcodeScanner";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { database } from "@/src/database";
import type Product from "@/src/database/models/Product";
import { playScannerBeep } from "@/src/utils/scannerAudio";
import {
  canIncreaseQuantity,
  fetchStockByProductId,
} from "@/src/features/orders/stock";
import { runSyncCycle } from "@/src/sync/syncEngine";
import { useOrderDraftStore } from "@/src/store/orderDraftStore";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";

type CatalogItem = {
  id: string;
  remoteId?: string;
  sku: string;
  name: string;
  price: number;
  barcode: string;
  stock: number;
};

function toMoney(value: number, currency: string) {
  const symbol = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";
  return `${symbol} ${value.toFixed(2)}`;
}

export default function AddOrderScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const [search, setSearch] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const { lines, addOrIncrementLine, setLineQty, removeLine, clearDraft } = useOrderDraftStore();
  const { currency } = useSettingsStore();

  const stockById = useMemo(() => new Map(catalog.map((item) => [item.id, item.stock])), [catalog]);

  const refreshCatalog = useCallback(async () => {
    if (!activeStoreId) {
      setCatalog([]);
      return;
    }
    await runSyncCycle(activeStoreId);
    const rows = await database
      .get<Product>("products")
      .query(Q.where("store_id", activeStoreId))
      .fetch();
    setCatalog(
      rows.map((row) => ({
        id: row.id,
        remoteId: row.remoteId,
        sku: row.sku,
        name: row.name,
        price: Number(row.sellPrice ?? 0),
        barcode: row.barcode ?? row.sku,
        stock: Number(row.stock ?? 0),
      })),
    );
  }, [activeStoreId]);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  const total = useMemo(() => lines.reduce((sum, row) => sum + row.price * row.quantity, 0), [lines]);
  const totalItemCount = useMemo(() => lines.reduce((sum, row) => sum + row.quantity, 0), [lines]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((item) => item.name.toLowerCase().includes(q) || item.barcode.includes(q)).slice(0, 5);
  }, [search, catalog]);

  function alertInsufficientStock(name: string, available: number) {
    Alert.alert(
      "Insufficient Stock",
      available <= 0 ? `"${name}" is out of stock.` : `"${name}" only has ${available} units in stock.`,
    );
  }

  async function tryAddFromCatalog(entry: CatalogItem) {
    const currentQty = lines.find((line) => line.id === entry.id)?.quantity ?? 0;
    const nextQty = currentQty + 1;

    let available = stockById.get(entry.id) ?? entry.stock;
    if (activeStoreId) {
      const fresh = await fetchStockByProductId(activeStoreId, [entry.id]);
      available = fresh.get(entry.id) ?? available;
    }

    if (!canIncreaseQuantity(entry.id, nextQty, new Map([[entry.id, available]]))) {
      alertInsufficientStock(entry.name, available);
      return;
    }

    addOrIncrementLine({
      id: entry.id,
      remoteId: entry.remoteId,
      sku: entry.sku,
      name: entry.name,
      price: entry.price,
      barcode: entry.barcode,
    });
    void playScannerBeep();
    setSearch("");
  }

  async function tryChangeQuantity(lineId: string, nextQty: number) {
    const line = lines.find((row) => row.id === lineId);
    if (!line || nextQty <= 0) {
      setLineQty(lineId, nextQty);
      return;
    }

    let available = stockById.get(lineId) ?? 0;
    if (activeStoreId) {
      const fresh = await fetchStockByProductId(activeStoreId, [lineId]);
      available = fresh.get(lineId) ?? available;
    }

    if (!canIncreaseQuantity(lineId, nextQty, new Map([[lineId, available]]))) {
      alertInsufficientStock(line.name, available);
      return;
    }

    setLineQty(lineId, nextQty);
  }

  function addFromSearchOrScan(payload: string) {
    const clean = payload.trim();
    setSearch(clean);
    const hit =
      catalog.find((item) => item.barcode === clean) ??
      catalog.find((item) => item.name.toLowerCase().includes(clean.toLowerCase()));
    if (hit) {
      void tryAddFromCatalog(hit);
    }
  }

  return (
    <AppScrollScreen showBack title="Add Order" subtitle="Scan barcodes or search products to build cart.">
      {/* Search & Barcode Scanner Card */}
      <SectionCard>
        <TextInput
          label="Search Inventory"
          value={search}
          onChangeText={setSearch}
          placeholder="Product name or barcode..."
          leftIcon={<Ionicons name="search-outline" size={18} color={Colors.textMuted} />}
          rightIcon={
            <Pressable
              onPress={() => setShowScanner((v) => !v)}
              hitSlop={10}
              style={({ pressed }) => [styles.scannerTrigger, pressed && { opacity: 0.7 }]}
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
              label="Point camera at product barcode"
              onScan={(payload) => {
                addFromSearchOrScan(payload);
                setShowScanner(false);
              }}
            />
          </View>
        ) : null}

        {/* Live Search Suggestions Dropdown */}
        {matches.length > 0 ? (
          <View style={styles.matchesContainer}>
            <Text style={styles.matchesTitle}>Matching Products ({matches.length})</Text>
            {matches.map((item) => {
              const isOut = item.stock <= 0;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => void tryAddFromCatalog(item)}
                  style={({ pressed }) => [
                    styles.matchRow,
                    isOut && styles.matchRowDisabled,
                    pressed && !isOut && styles.matchRowPressed,
                  ]}
                  disabled={isOut}
                >
                  <View style={styles.matchThumb}>
                    <Ionicons name="cube-outline" size={20} color={isOut ? Colors.textMuted : Colors.primaryBlue} />
                  </View>
                  <View style={styles.matchInfo}>
                    <Text style={styles.matchName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <View style={styles.matchMetaRow}>
                      <Text style={styles.matchBarcode}>{item.barcode || item.sku}</Text>
                      <View style={[styles.stockBadge, isOut ? styles.stockBadgeOut : styles.stockBadgeIn]}>
                        <Text style={[styles.stockBadgeText, isOut ? styles.stockTextOut : styles.stockTextIn]}>
                          {isOut ? "Out of stock" : `${item.stock} in stock`}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.matchPriceWrap}>
                    <Text style={styles.matchPrice}>{toMoney(item.price, currency)}</Text>
                    {!isOut ? (
                      <View style={styles.addPill}>
                        <Ionicons name="add" size={14} color={Colors.white} />
                        <Text style={styles.addPillText}>Add</Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {!showScanner && catalog.length === 0 ? (
          <Text style={styles.emptyNotice}>No inventory products found for this store.</Text>
        ) : null}
      </SectionCard>

      {/* Cart Items List */}
      <SectionCard>
        <View style={styles.cartHeader}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="cart" size={20} color={Colors.primaryBlue} />
            <Text style={styles.sectionTitle}>Cart Items</Text>
          </View>
          <View style={styles.itemCountBadge}>
            <Text style={styles.itemCountBadgeText}>
              {totalItemCount} {totalItemCount === 1 ? "unit" : "units"} ({lines.length} items)
            </Text>
          </View>
        </View>

        {lines.length > 0 ? (
          <View style={styles.cartList}>
            {lines.map((line) => {
              const available = stockById.get(line.id) ?? 0;
              const lineTotal = line.price * line.quantity;
              return (
                <Swipeable
                  key={line.id}
                  renderRightActions={() => (
                    <Pressable style={styles.swipeDeleteAction} onPress={() => removeLine(line.id)}>
                      <Ionicons name="trash-outline" size={20} color={Colors.white} />
                      <Text style={styles.swipeDeleteText}>Delete</Text>
                    </Pressable>
                  )}
                  onSwipeableOpen={() => removeLine(line.id)}
                >
                  <View style={styles.cartCard}>
                    <View style={styles.cartThumb}>
                      <Ionicons name="bag-handle-outline" size={22} color={Colors.primaryBlue} />
                    </View>

                    <View style={styles.cartDetails}>
                      <Text style={styles.itemName} numberOfLines={2}>
                        {line.name}
                      </Text>
                      <Text style={styles.itemUnitPrice}>{toMoney(line.price, currency)} each</Text>
                      <Text style={styles.itemStockNotice}>
                        Max available: {available}
                      </Text>
                    </View>

                    <View style={styles.cartRightSection}>
                      <Text style={styles.cartLineTotal}>{toMoney(lineTotal, currency)}</Text>
                      
                      {/* Quantity Stepper */}
                      <View style={styles.stepperContainer}>
                        <Pressable
                          style={({ pressed }) => [styles.stepBtn, pressed && styles.stepBtnPressed]}
                          onPress={() => void tryChangeQuantity(line.id, line.quantity - 1)}
                        >
                          <Ionicons name={line.quantity === 1 ? "trash-outline" : "remove"} size={14} color={line.quantity === 1 ? Colors.danger : Colors.textPrimary} />
                        </Pressable>
                        <Text style={styles.stepCount}>{line.quantity}</Text>
                        <Pressable
                          style={({ pressed }) => [
                            styles.stepBtn,
                            line.quantity >= available && styles.stepBtnDisabled,
                            pressed && styles.stepBtnPressed,
                          ]}
                          onPress={() => void tryChangeQuantity(line.id, line.quantity + 1)}
                          disabled={line.quantity >= available}
                        >
                          <Ionicons name="add" size={14} color={line.quantity >= available ? Colors.textMuted : Colors.primaryBlue} />
                        </Pressable>
                      </View>
                    </View>
                  </View>
                </Swipeable>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyCartBox}>
            <View style={styles.emptyCartIconWrap}>
              <Ionicons name="cart-outline" size={36} color={Colors.textMuted} />
            </View>
            <Text style={styles.emptyCartTitle}>Your cart is empty</Text>
            <Text style={styles.emptyCartSubtitle}>Search or scan product barcodes above to add items to this order.</Text>
          </View>
        )}
      </SectionCard>

      {/* Floating / Bottom Checkout Bar */}
      {lines.length > 0 ? (
        <View style={styles.bottomBar}>
          <View style={styles.totalPreviewBox}>
            <View>
              <Text style={styles.totalLabelSmall}>Order Total</Text>
              <Text style={styles.totalValueLarge}>{toMoney(total, currency)}</Text>
            </View>
            <Pressable
              style={styles.clearBtn}
              onPress={() => {
                Alert.alert("Clear Order", "Are you sure you want to remove all items from this order?", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Clear", style: "destructive", onPress: clearDraft },
                ]);
              }}
            >
              <Ionicons name="trash-outline" size={16} color={Colors.danger} />
              <Text style={styles.clearBtnText}>Clear</Text>
            </Pressable>
          </View>

          <Pressable
            style={({ pressed }) => [styles.checkoutButton, pressed && styles.checkoutButtonPressed]}
            onPress={() => router.push("/pos/order-info")}
          >
            <View style={styles.checkoutLeft}>
              <View style={styles.checkoutUnitBadge}>
                <Text style={styles.checkoutUnitText}>{totalItemCount}</Text>
              </View>
              <Text style={styles.checkoutBtnText}>Proceed to Payment</Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color={Colors.white} />
          </Pressable>
        </View>
      ) : null}
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  scannerTrigger: {
    padding: 4,
  },
  scannerWrapper: {
    marginTop: Spacing.sm,
    borderRadius: Radius.card,
    overflow: "hidden",
  },
  matchesContainer: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
    backgroundColor: Colors.background,
    borderRadius: Radius.card,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  matchesTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textMuted,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.sm,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: "#f1f5f9",
  },
  matchRowPressed: {
    backgroundColor: "#f8fafc",
  },
  matchRowDisabled: {
    opacity: 0.5,
  },
  matchThumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  matchInfo: {
    flex: 1,
  },
  matchName: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  matchMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  matchBarcode: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  stockBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  stockBadgeIn: {
    backgroundColor: "#dcfce7",
  },
  stockBadgeOut: {
    backgroundColor: "#fee2e2",
  },
  stockBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  stockTextIn: {
    color: "#16a34a",
  },
  stockTextOut: {
    color: "#dc2626",
  },
  matchPriceWrap: {
    alignItems: "flex-end",
    gap: 4,
  },
  matchPrice: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  addPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primaryBlue,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 2,
  },
  addPillText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: "700",
  },
  emptyNotice: {
    textAlign: "center",
    color: Colors.textMuted,
    fontSize: 13,
    paddingVertical: Spacing.sm,
  },
  cartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  itemCountBadge: {
    backgroundColor: Colors.primaryBluePale,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  itemCountBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  cartList: {
    gap: Spacing.xs,
  },
  cartCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.sm,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  cartThumb: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  cartDetails: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  itemUnitPrice: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  itemStockNotice: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  cartRightSection: {
    alignItems: "flex-end",
    gap: 6,
  },
  cartLineTotal: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  stepperContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 2,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnPressed: {
    backgroundColor: "#e2e8f0",
  },
  stepBtnDisabled: {
    opacity: 0.3,
  },
  stepCount: {
    paddingHorizontal: 8,
    fontSize: 13,
    fontWeight: "800",
    color: Colors.textPrimary,
    minWidth: 26,
    textAlign: "center",
  },
  emptyCartBox: {
    alignItems: "center",
    paddingVertical: Spacing.lg,
    gap: Spacing.xs,
  },
  emptyCartIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyCartTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  emptyCartSubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: "center",
    paddingHorizontal: Spacing.lg,
  },
  swipeDeleteAction: {
    backgroundColor: Colors.danger,
    borderRadius: Radius.input,
    justifyContent: "center",
    alignItems: "center",
    width: 72,
    marginVertical: 2,
    gap: 2,
  },
  swipeDeleteText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: "700",
  },
  bottomBar: {
    marginTop: Spacing.xs,
    gap: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  totalPreviewBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  totalLabelSmall: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  totalValueLarge: {
    fontSize: 24,
    fontWeight: "900",
    color: Colors.textPrimary,
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.danger,
  },
  checkoutButton: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.primaryBlue,
    borderRadius: Radius.pill,
    paddingVertical: 16,
    paddingHorizontal: Spacing.lg,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  checkoutButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  checkoutLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  checkoutUnitBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  checkoutUnitText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: "800",
  },
  checkoutBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "800",
  },
});
