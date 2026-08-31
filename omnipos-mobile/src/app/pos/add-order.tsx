import Ionicons from "@expo/vector-icons/Ionicons";
import { Q } from "@nozbe/watermelondb";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
import { synchronise } from "@/src/sync";
import { useOrderDraftStore } from "@/src/store/orderDraftStore";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";
import { useActiveShift } from "@/src/features/shifts/hooks";

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

  const {
    lines,
    addOrIncrementLine,
    setLineQty,
    removeLine,
    clearDraft,
    parkedOrders,
    parkCurrentCart,
    resumeParkedCart,
    deleteParkedCart,
  } = useOrderDraftStore();
  const { currency } = useSettingsStore();
  const { data: activeShift } = useActiveShift();

  const [showParkModal, setShowParkModal] = useState(false);
  const [parkTag, setParkTag] = useState("");
  const [showParkedListModal, setShowParkedListModal] = useState(false);

  const stockById = useMemo(() => new Map(catalog.map((item) => [item.id, item.stock])), [catalog]);

  const refreshCatalog = useCallback(async () => {
    if (!activeStoreId) {
      setCatalog([]);
      return;
    }
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

    // Non-blocking sync in background
    void synchronise(activeStoreId);
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
      name: entry.name,
      price: entry.price,
      barcode: entry.barcode,
      remoteId: entry.remoteId,
      sku: entry.sku,
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

  function handleConfirmPark() {
    const tag = parkTag.trim() || `Tab #${parkedOrders.length + 1}`;
    parkCurrentCart(tag);
    setShowParkModal(false);
    setParkTag("");
    Alert.alert("Cart Held / Parked", `Order "${tag}" has been held. You can resume it anytime.`);
  }

  function handleResumeParked(id: string) {
    if (lines.length > 0) {
      Alert.alert(
        "Replace Active Cart?",
        "Your current cart has items. Resuming this tab will overwrite your active cart.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Resume Tab",
            onPress: () => {
              resumeParkedCart(id);
              setShowParkedListModal(false);
            },
          },
        ],
      );
    } else {
      resumeParkedCart(id);
      setShowParkedListModal(false);
    }
  }

  return (
    <AppScrollScreen showBack title="Add Order" subtitle="Scan barcodes or search products to build cart.">
      {/* Quick Action Top Bar: Shifts & Parked Orders */}
      <View style={styles.topShortcutsRow}>
        <Pressable
          style={styles.shortcutBtn}
          onPress={() => router.push("/pos/shifts")}
        >
          <View style={[styles.statusDot, { backgroundColor: activeShift ? "#4ade80" : "#f87171" }]} />
          <Ionicons name="cash-outline" size={16} color={Colors.textPrimary} />
          <Text style={styles.shortcutBtnText}>
            {activeShift ? "Register Open" : "Register Closed"}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.shortcutBtn, parkedOrders.length > 0 && styles.shortcutBtnActive]}
          onPress={() => setShowParkedListModal(true)}
        >
          <Ionicons
            name="pause-circle-outline"
            size={16}
            color={parkedOrders.length > 0 ? "#38bdf8" : Colors.textPrimary}
          />
          <Text
            style={[
              styles.shortcutBtnText,
              parkedOrders.length > 0 && { color: "#38bdf8", fontWeight: "700" },
            ]}
          >
            Parked Tabs ({parkedOrders.length})
          </Text>
        </Pressable>
      </View>

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
              style={styles.scannerTrigger}
            >
              <Ionicons
                name={showScanner ? "close-circle" : "barcode-outline"}
                size={22}
                color={showScanner ? Colors.danger : Colors.primaryBlue}
              />
            </Pressable>
          }
        />

        {showScanner ? (
          <View style={styles.scannerWrapper}>
            <BarcodeScanner
              onScan={(code) => {
                addFromSearchOrScan(code);
                setShowScanner(false);
              }}
            />
          </View>
        ) : null}

        {/* Live Search Quick Results */}
        {matches.length > 0 ? (
          <View style={styles.matchesContainer}>
            <Text style={styles.matchesTitle}>Matching Catalog Items</Text>
            {matches.map((item) => {
              const inCartQty = lines.find((line) => line.id === item.id)?.quantity ?? 0;
              const available = stockById.get(item.id) ?? item.stock;
              const isOut = available <= 0 || inCartQty >= available;

              return (
                <Pressable
                  key={item.id}
                  style={({ pressed }) => [
                    styles.matchRow,
                    pressed && styles.matchRowPressed,
                    isOut && styles.matchRowDisabled,
                  ]}
                  onPress={() => void tryAddFromCatalog(item)}
                  disabled={isOut}
                >
                  <View style={styles.matchThumb}>
                    <Ionicons name="cube-outline" size={18} color={Colors.primaryBlue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.matchName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.matchMeta}>
                      SKU: {item.sku} • Stock: {available} {inCartQty > 0 ? `(${inCartQty} in cart)` : ""}
                    </Text>
                  </View>
                  <Text style={styles.matchPrice}>{toMoney(item.price, currency)}</Text>
                  <Ionicons
                    name={isOut ? "ban-outline" : "add-circle"}
                    size={22}
                    color={isOut ? Colors.textMuted : Colors.primaryBlue}
                  />
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </SectionCard>

      {/* Cart Items Section */}
      <SectionCard>
        <View style={styles.cartSectionHeader}>
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
                          <Ionicons
                            name={line.quantity === 1 ? "trash-outline" : "remove"}
                            size={14}
                            color={line.quantity === 1 ? Colors.danger : Colors.textPrimary}
                          />
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
                          <Ionicons
                            name="add"
                            size={14}
                            color={line.quantity >= available ? Colors.textMuted : Colors.primaryBlue}
                          />
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
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                style={styles.parkBtn}
                onPress={() => {
                  setParkTag(`Tab #${parkedOrders.length + 1}`);
                  setShowParkModal(true);
                }}
              >
                <Ionicons name="pause-circle-outline" size={16} color="#38bdf8" />
                <Text style={styles.parkBtnText}>Hold Tab</Text>
              </Pressable>

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

      {/* PARK CURRENT CART MODAL */}
      <Modal visible={showParkModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Park / Hold Order</Text>
            <Text style={styles.modalSub}>
              Save this customer&apos;s cart temporarily so you can ring up the next customer in line.
            </Text>

            <TextInput
              label="Tab / Customer Label *"
              placeholder="e.g. Table 4, Kwame Mensah, Bar Seat 2"
              value={parkTag}
              onChangeText={setParkTag}
            />

            <View style={styles.modalBtnRow}>
              <Pressable style={styles.modalCancelBtn} onPress={() => setShowParkModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalConfirmBtn} onPress={handleConfirmPark}>
                <Text style={styles.modalConfirmText}>Hold Cart</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* PARKED TABS LIST MODAL */}
      <Modal visible={showParkedListModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: "80%" }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Parked Tabs ({parkedOrders.length})</Text>
              <Pressable onPress={() => setShowParkedListModal(false)}>
                <Ionicons name="close-circle-outline" size={24} color="#94a3b8" />
              </Pressable>
            </View>

            {parkedOrders.length === 0 ? (
              <View style={styles.emptyParkedBox}>
                <Ionicons name="receipt-outline" size={40} color="#64748b" />
                <Text style={styles.emptyParkedText}>No parked orders currently on hold.</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                {parkedOrders.map((p) => {
                  const pTotal = p.lines.reduce((s, l) => s + l.price * l.quantity, 0);
                  const pUnits = p.lines.reduce((s, l) => s + l.quantity, 0);
                  return (
                    <View key={p.id} style={styles.parkedItemCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.parkedTag}>{p.tag}</Text>
                        <Text style={styles.parkedMeta}>
                          {pUnits} items • {toMoney(pTotal, currency)} • Held at{" "}
                          {new Date(p.parkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        <Pressable
                          style={styles.resumeBtn}
                          onPress={() => handleResumeParked(p.id)}
                        >
                          <Ionicons name="play" size={14} color={Colors.white} />
                          <Text style={styles.resumeBtnText}>Resume</Text>
                        </Pressable>
                        <Pressable
                          style={styles.discardBtn}
                          onPress={() => {
                            Alert.alert("Discard Tab", `Delete "${p.tag}"?`, [
                              { text: "Cancel", style: "cancel" },
                              { text: "Discard", style: "destructive", onPress: () => deleteParkedCart(p.id) },
                            ]);
                          }}
                        >
                          <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}

            <Pressable
              style={styles.modalCloseDoneBtn}
              onPress={() => setShowParkedListModal(false)}
            >
              <Text style={styles.modalCloseDoneText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  topShortcutsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  shortcutBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.surface,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  shortcutBtnActive: {
    borderColor: Colors.primaryBlueLight,
    backgroundColor: Colors.primaryBluePale,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  shortcutBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
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
    borderRadius: Radius.sm,
    backgroundColor: "#f0fdf4",
    alignItems: "center",
    justifyContent: "center",
  },
  matchName: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  matchMeta: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  matchPrice: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  cartSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  itemCountBadge: {
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  itemCountBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.textMuted,
  },
  cartList: {
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  cartCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: "#f1f5f9",
  },
  cartThumb: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
  },
  cartDetails: {
    flex: 1,
    gap: 2,
  },
  itemName: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  itemUnitPrice: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  itemStockNotice: {
    fontSize: 11,
    color: "#64748b",
  },
  cartRightSection: {
    alignItems: "flex-end",
    gap: 6,
  },
  cartLineTotal: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  stepperContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 2,
    gap: 6,
  },
  stepBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepBtnPressed: {
    backgroundColor: "#f1f5f9",
  },
  stepBtnDisabled: {
    opacity: 0.3,
  },
  stepCount: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
    minWidth: 16,
    textAlign: "center",
  },
  swipeDeleteAction: {
    backgroundColor: Colors.danger,
    justifyContent: "center",
    alignItems: "center",
    width: 76,
    borderRadius: Radius.card,
    marginLeft: Spacing.sm,
    gap: 2,
  },
  swipeDeleteText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: "700",
  },
  emptyCartBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.xl,
    gap: Spacing.xs,
  },
  emptyCartIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  emptyCartTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  emptyCartSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: "center",
    maxWidth: 240,
  },
  bottomBar: {
    marginTop: Spacing.md,
    gap: Spacing.md,
  },
  totalPreviewBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  totalLabelSmall: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  totalValueLarge: {
    fontSize: 22,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  parkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryBluePale,
    borderWidth: 1,
    borderColor: Colors.primaryBlue,
  },
  parkBtnText: {
    fontSize: 12,
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.md,
    backgroundColor: "#fee2e2",
  },
  clearBtnText: {
    fontSize: 12,
    color: Colors.danger,
    fontWeight: "700",
  },
  checkoutButton: {
    backgroundColor: Colors.primaryBlue,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.lg,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  checkoutButtonPressed: {
    opacity: 0.85,
  },
  checkoutLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  checkoutUnitBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  checkoutUnitText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: "700",
  },
  checkoutBtnText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(4, 35, 88, 0.45)",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 6,
  },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  modalSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: "400",
    lineHeight: 18,
  },
  modalBtnRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Radius.lg,
    alignItems: "center",
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalCancelText: {
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Radius.lg,
    alignItems: "center",
    backgroundColor: Colors.primaryBlue,
  },
  modalConfirmText: {
    color: Colors.white,
    fontWeight: "700",
  },
  emptyParkedBox: {
    paddingVertical: Spacing.xl,
    alignItems: "center",
    gap: Spacing.sm,
  },
  emptyParkedText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "400",
  },
  parkedItemCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  parkedTag: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  parkedMeta: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  resumeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.success,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.md,
  },
  resumeBtnText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: "700",
  },
  discardBtn: {
    padding: 6,
    borderRadius: Radius.md,
    backgroundColor: "#fee2e2",
  },
  modalCloseDoneBtn: {
    backgroundColor: Colors.background,
    paddingVertical: 12,
    borderRadius: Radius.lg,
    alignItems: "center",
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalCloseDoneText: {
    color: Colors.textSecondary,
    fontWeight: "600",
  },
});
