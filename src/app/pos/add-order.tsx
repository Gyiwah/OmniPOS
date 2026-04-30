import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { BarcodeScanner } from "@/src/components/organisms/BarcodeScanner";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { useOrderDraftStore } from "@/src/store/orderDraftStore";
import { useSettingsStore } from "@/src/store/settingsStore";

type CatalogItem = { id: string; name: string; price: number; barcode: string };

const CATALOG: CatalogItem[] = [
  { id: "p1", name: "Sawyer Picaridin Insect Repellent", price: 13, barcode: "050716005646" },
  { id: "p2", name: "Dove advanced CARE", price: 33, barcode: "024000000000" },
  { id: "p3", name: "Filtered water 500ml", price: 2.5, barcode: "111111111111" },
  { id: "p4", name: "Wholewheat loaf", price: 8, barcode: "222222222222" },
];

function toMoney(value: number, currency: string) {
  const symbol = currency === "USD" ? "$" : currency === "NGN" ? "?" : "?";
  return `${symbol} ${value.toFixed(2)}`;
}

export default function AddOrderScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const { lines, addOrIncrementLine, setLineQty, removeLine, clearDraft } = useOrderDraftStore();
  const { currency } = useSettingsStore();

  const total = useMemo(() => lines.reduce((sum, row) => sum + row.price * row.quantity, 0), [lines]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return CATALOG.filter((item) => item.name.toLowerCase().includes(q) || item.barcode.includes(q)).slice(0, 5);
  }, [search]);

  function addFromCatalog(entry: CatalogItem) {
    addOrIncrementLine({ id: entry.id, name: entry.name, price: entry.price, barcode: entry.barcode });
  }

  function addFromSearchOrScan(payload: string) {
    const clean = payload.trim();
    setSearch(clean);
    const hit =
      CATALOG.find((item) => item.barcode === clean) ??
      CATALOG.find((item) => item.name.toLowerCase().includes(clean.toLowerCase()));
    if (hit) addFromCatalog(hit);
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
              <Pressable key={item.id} onPress={() => addFromCatalog(item)} style={styles.matchRow}>
                <View>
                  <Text style={styles.matchName}>{item.name}</Text>
                  <Text style={styles.matchMeta}>{item.barcode}</Text>
                </View>
                <Text style={styles.matchPrice}>{toMoney(item.price, currency)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </SectionCard>

      <SectionCard>
        <View style={styles.orderHeader}>
          <Text style={styles.sectionTitle}>Order Items</Text>
          <Text style={styles.itemCount}>{lines.length}</Text>
        </View>
        <View style={styles.cartList}>
          {lines.map((line) => (
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
                </View>
                <View style={styles.qtyBlock}>
                  <Text style={styles.qtyVal}>{line.quantity}</Text>
                </View>
                <View style={styles.stepCol}>
                  <Pressable style={styles.stepBtn} onPress={() => setLineQty(line.id, line.quantity + 1)}>
                    <Text style={styles.stepText}>+</Text>
                  </Pressable>
                  <Pressable style={styles.stepBtn} onPress={() => setLineQty(line.id, line.quantity - 1)}>
                    <Text style={styles.stepText}>-</Text>
                  </Pressable>
                </View>
              </View>
            </Swipeable>
          ))}
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
  stepText: { color: Colors.textWhite, fontSize: 16, lineHeight: 18, fontWeight: "700" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: Spacing.sm },
  totalLabel: { fontSize: 32, color: Colors.textPrimary, fontWeight: "600" },
  totalValue: { fontSize: 44, color: Colors.textPrimary, fontWeight: "800" },
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
