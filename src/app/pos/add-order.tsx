import Ionicons from "@expo/vector-icons/Ionicons";
import { Q } from "@nozbe/watermelondb";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { BarcodeScanner } from "@/src/components/organisms/BarcodeScanner";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { database } from "@/src/database";
import type Product from "@/src/database/models/Product";
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

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((item) => item.name.toLowerCase().includes(q) || item.barcode.includes(q)).slice(0, 5);
  }, [search, catalog]);

  function alertInsufficientStock(name: string, available: number) {
    Alert.alert(
      "Insufficient stock",
      available <= 0 ? `"${name}" is out of stock.` : `"${name}" only has ${available} in stock.`,
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
    if (hit) void tryAddFromCatalog(hit);
  }

  return (
    <AppScrollScreen showBack title="Add Order" subtitle="Scan or search products to build cart.">
      <SectionCard>
        <TextInput
          label="Scan / search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search product"
          rightIcon={
            <Pressable onPress={() => setShowScanner((v) => !v)} hitSlop={10}>
              <Ionicons
                name={showScanner ? "close-circle-outline" : "scan-outline"}
                size={22}
                color={Colors.primaryBlue}
              />
            </Pressable>
          }
        />
        {showScanner ? (
          <BarcodeScanner
            label="Scan Product Code"
            onScan={(payload) => {
              addFromSearchOrScan(payload);
              setShowScanner(false);
            }}
          />
        ) : null}

        {matches.length > 0 ? (
          <View style={styles.matches}>
            {matches.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => void tryAddFromCatalog(item)}
                style={[styles.matchRow, item.stock <= 0 && styles.matchRowDisabled]}
                disabled={item.stock <= 0}
              >
                <View>
                  <Text style={styles.matchName}>{item.name}</Text>
                  <Text style={styles.matchMeta}>
                    {item.barcode} · Stock {item.stock}
                  </Text>
                </View>
                <Text style={styles.matchPrice}>{toMoney(item.price, currency)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {!showScanner && catalog.length === 0 ? (
          <Text style={styles.empty}>No inventory products found for this store.</Text>
        ) : null}
      </SectionCard>

      <SectionCard>
        <View style={styles.orderHeader}>
          <Text style={styles.sectionTitle}>Order Items</Text>
          <Text style={styles.itemCount}>{lines.length}</Text>
        </View>
        <View style={styles.cartList}>
          {lines.map((line) => {
            const available = stockById.get(line.id) ?? 0;
            return (
              <Swipeable
                key={line.id}
                renderLeftActions={() => <View style={styles.swipeBg} />}
                renderRightActions={() => (
                  <View style={[styles.swipeBg, { alignItems: "flex-end" }]}>
                    <Text style={styles.swipeText}>Remove</Text>
                  </View>
                )}
                onSwipeableOpen={() => removeLine(line.id)}
              >
                <View style={styles.cartRow}>
                  <View style={styles.thumb} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {line.name}
                    </Text>
                    <Text style={styles.itemPrice}>{toMoney(line.price, currency)}</Text>
                    <Text style={styles.itemStock}>
                      {line.quantity} of {available} in stock
                    </Text>
                  </View>
                  <View style={styles.qtyBlock}>
                    <Text style={styles.qtyVal}>{line.quantity}</Text>
                  </View>
                  <View style={styles.stepCol}>
                    <Pressable
                      style={[styles.stepBtn, line.quantity >= available && styles.stepBtnDisabled]}
                      onPress={() => void tryChangeQuantity(line.id, line.quantity + 1)}
                      disabled={line.quantity >= available}
                    >
                      <Text style={styles.stepText}>+</Text>
                    </Pressable>
                    <Pressable style={styles.stepBtn} onPress={() => void tryChangeQuantity(line.id, line.quantity - 1)}>
                      <Text style={styles.stepText}>-</Text>
                    </Pressable>
                  </View>
                </View>
              </Swipeable>
            );
          })}
          {lines.length === 0 ? <Text style={styles.empty}>No items yet. Scan/search to add products.</Text> : null}
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total price</Text>
          <Text style={styles.totalValue}>{toMoney(total, currency)}</Text>
        </View>
      </SectionCard>

      <PrimaryButton
        label="Create order"
        onPress={() => {
          if (lines.length === 0) return;
          router.push("/pos/order-info");
        }}
      />
      <PrimaryButton label="Clear order" variant="outline" onPress={clearDraft} />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  matches: { gap: Spacing.xs },
  matchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 7,
  },
  matchRowDisabled: {
    opacity: 0.5,
  },
  matchName: { color: Colors.textPrimary, fontWeight: "600" },
  matchMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  matchPrice: { color: Colors.primaryBlue, fontWeight: "700" },
  orderHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  itemCount: { ...Typography.title, color: Colors.textSecondary },
  cartList: {
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.card,
    padding: Spacing.sm,
    gap: Spacing.xs,
  },
  cartRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.xs,
  },
  thumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: Colors.divider },
  itemName: { color: Colors.textPrimary, fontSize: 15, fontWeight: "700" },
  itemPrice: { color: Colors.textSecondary, marginTop: 3 },
  itemStock: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  qtyBlock: {
    minWidth: 36,
    height: 44,
    borderRadius: 10,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyVal: { fontWeight: "700", color: Colors.textPrimary },
  stepCol: { gap: 4 },
  stepBtn: {
    width: 34,
    height: 20,
    borderRadius: 6,
    backgroundColor: "#18b5b4",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnDisabled: {
    opacity: 0.4,
  },
  stepText: { color: Colors.textWhite, fontSize: 16, lineHeight: 18, fontWeight: "700" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: Spacing.sm },
  totalLabel: { fontSize: 22, color: Colors.textPrimary, fontWeight: "600" },
  totalValue: { fontSize: 30, color: Colors.textPrimary, fontWeight: "800" },
  empty: { textAlign: "center", color: Colors.textMuted, paddingVertical: Spacing.sm },
  swipeBg: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: Colors.danger,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    marginVertical: 2,
  },
  swipeText: { color: Colors.textWhite, fontWeight: "700" },
});
