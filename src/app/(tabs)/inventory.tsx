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
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { database } from "@/src/database";
import type Product from "@/src/database/models/Product";
import type SyncQueueItem from "@/src/database/models/SyncQueueItem";
import { resolveProductImageUrl } from "@/src/services/storage";
import { runSyncCycle } from "@/src/sync/syncEngine";
import { useStoreSlice } from "@/src/store/storeSlice";

type InventoryRow = {
  id: string;
  name: string;
  stockCount: number;
  lowStockThreshold: number;
  imageUrl?: string | null;
};

export default function InventoryScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const [query, setQuery] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");
  const [products, setProducts] = useState<InventoryRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      async function loadInventory() {
        if (!activeStoreId) {
          if (mounted) setProducts([]);
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
            return {
              id: p.id,
              name: p.name,
              stockCount: Number(p.stock ?? 0),
              lowStockThreshold: Number(p.reorderLevel ?? 5),
              imageUrl: await resolveProductImageUrl(rawImage),
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
      if (stockFilter === "out" && p.stockCount > 0) return false;
      if (stockFilter === "low" && !(p.stockCount <= p.lowStockThreshold)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        String(p.stockCount).includes(q)
      );
    });
  }, [products, query, stockFilter]);

  return (
    <AppScrollScreen title="Inventory" subtitle="Stock overview.">
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
        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setStockFilter("all")}
            style={[styles.filterPill, stockFilter === "all" && styles.filterPillActive]}
          >
            <Text style={[styles.filterText, stockFilter === "all" && styles.filterTextActive]}>All</Text>
          </Pressable>
          <Pressable
            onPress={() => setStockFilter("low")}
            style={[styles.filterPill, stockFilter === "low" && styles.filterPillActive]}
          >
            <Text style={[styles.filterText, stockFilter === "low" && styles.filterTextActive]}>Low stock</Text>
          </Pressable>
          <Pressable
            onPress={() => setStockFilter("out")}
            style={[styles.filterPill, stockFilter === "out" && styles.filterPillActive]}
          >
            <Text style={[styles.filterText, stockFilter === "out" && styles.filterTextActive]}>Out of stock</Text>
          </Pressable>
        </View>
      </SectionCard>

      <SectionCard>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Products</Text>
          <PrimaryButton
            label="Add"
            variant="outline"
            fullWidth={false}
            style={styles.addBtn}
            onPress={() => router.push("/product/add")}
          />
        </View>
        <View style={styles.list}>
          {rows.map((p) => (
            <ProductCard
              key={p.id}
              imageUrl={p.imageUrl}
              name={p.name}
              stockCount={p.stockCount}
              lowStockThreshold={p.lowStockThreshold}
              onPress={() => router.push(`/product/edit/${p.id}`)}
            />
          ))}
          {rows.length === 0 ? <Text style={styles.empty}>No products match your search/filter.</Text> : null}
        </View>
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
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
  addBtn: {
    alignSelf: "flex-start",
    minWidth: 88,
  },
  list: {
    gap: Spacing.sm,
  },
  filterRow: {
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
    fontWeight: "600",
  },
  filterTextActive: {
    color: Colors.primaryBlue,
  },
  empty: {
    marginTop: Spacing.xs,
    color: Colors.textMuted,
    textAlign: "center",
  },
});
