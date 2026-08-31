import Ionicons from "@expo/vector-icons/Ionicons";
import { Q } from "@nozbe/watermelondb";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { BarcodeScanner } from "@/src/components/organisms/BarcodeScanner";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { database } from "@/src/database";
import type Order from "@/src/database/models/Order";
import type OrderItem from "@/src/database/models/OrderItem";
import { runSyncCycle } from "@/src/sync/syncEngine";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";

type OrderFilter = "all" | "open" | "part";
type OrderRecord = {
  id: string;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  dateLabel: string;
  itemCount: number;
  total: number;
  amountPaid: number;
  isPartPayment: boolean;
};

export default function OrdersScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const currency = useSettingsStore((s) => s.currency);
  const currencySymbol = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";

  const [query, setQuery] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OrderFilter>("all");
  const [sourceRows, setSourceRows] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadLocalOrders = useCallback(async () => {
    if (!activeStoreId) {
      setSourceRows([]);
      return;
    }
    setLoading(true);
    try {
      // 1. Fetch Orders from local WatermelonDB
      const orders = await database
        .get<Order>("orders")
        .query(
          Q.where("store_id", activeStoreId),
          Q.sortBy("created_at", Q.desc),
          Q.take(150),
        )
        .fetch();

      // 2. Fetch Order Items count from local WatermelonDB
      const orderIds = orders.map((o) => o.id);
      const counts = new Map<string, number>();

      if (orderIds.length > 0) {
        const items = await database
          .get<OrderItem>("order_items")
          .query(Q.where("store_id", activeStoreId))
          .fetch();

        items.forEach((item) => {
          const id = item.orderId;
          const qty = Number(item.quantity ?? 0);
          counts.set(id, (counts.get(id) ?? 0) + qty);
        });
      }

      setSourceRows(
        orders.map((o) => {
          const total = Number(o.total ?? 0);
          const paid = Number(o.amountPaid ?? total);
          const isPartPayment = paid + 0.0001 < total;
          return {
            id: String(o.id),
            orderNumber: String(o.orderNumber || o.id.slice(0, 8)),
            customerName: o.customerName ?? null,
            customerPhone: o.customerPhone ?? null,
            dateLabel: new Date(Number(o.createdAt)).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
            itemCount: counts.get(String(o.id)) ?? 0,
            total,
            amountPaid: paid,
            isPartPayment,
          };
        }),
      );
    } catch {
      setSourceRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeStoreId]);

  useEffect(() => {
    void loadLocalOrders();
    // Trigger non-blocking background sync
    if (activeStoreId) {
      void runSyncCycle(activeStoreId).then(() => {
        void loadLocalOrders();
      });
    }
  }, [activeStoreId, loadLocalOrders]);

  const handleRefresh = async () => {
    if (!activeStoreId) return;
    setRefreshing(true);
    try {
      await runSyncCycle(activeStoreId);
      await loadLocalOrders();
    } finally {
      setRefreshing(false);
    }
  };

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sourceRows.filter((order) => {
      if (statusFilter === "part" && !order.isPartPayment) return false;
      if (statusFilter === "open" && order.isPartPayment) return false;
      if (!q) return true;
      return (
        order.orderNumber.toLowerCase().includes(q) ||
        (order.customerName ?? "").toLowerCase().includes(q) ||
        (order.customerPhone ?? "").toLowerCase().includes(q) ||
        order.dateLabel.toLowerCase().includes(q) ||
        order.total.toString().includes(q)
      );
    });
  }, [query, sourceRows, statusFilter]);

  const totalVolume = useMemo(
    () => filteredRows.reduce((sum, o) => sum + o.total, 0),
    [filteredRows],
  );

  return (
    <AppScrollScreen
      title="Orders & Sales"
      subtitle="Offline-first transaction registry, payments, and receipts."
      refreshing={refreshing}
      onRefresh={() => void handleRefresh()}
      right={
        <Pressable
          style={({ pressed }) => [styles.headerAddBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.push("/pos/add-order")}
        >
          <Ionicons name="add" size={18} color={Colors.white} />
          <Text style={styles.headerAddText}>New Sale</Text>
        </Pressable>
      }
    >
      {/* Top Metrics Row */}
      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Total Orders</Text>
          <Text style={styles.metricValue}>{filteredRows.length}</Text>
        </View>
        <View style={[styles.metricCard, { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" }]}>
          <Text style={[styles.metricLabel, { color: "#16a34a" }]}>Sales Volume</Text>
          <Text style={[styles.metricValue, { color: "#15803d" }]}>
            {currencySymbol} {totalVolume.toFixed(2)}
          </Text>
        </View>
      </View>

      {/* Search & Filter Section */}
      <SectionCard>
        <TextInput
          label="Search Orders"
          value={query}
          onChangeText={setQuery}
          placeholder="Order #, customer name, phone, or amount..."
          leftIcon={<Ionicons name="search-outline" size={18} color={Colors.textMuted} />}
          rightIcon={
            <Pressable onPress={() => setShowScanner((v) => !v)} hitSlop={10} style={{ padding: 4 }}>
              <Ionicons
                name={showScanner ? "close-circle" : "barcode-outline"}
                size={22}
                color={Colors.primaryBlue}
              />
            </Pressable>
          }
        />

        {showScanner ? (
          <View style={styles.scannerWrap}>
            <BarcodeScanner
              label="Scan receipt barcode to lookup order"
              onScan={(payload) => {
                setQuery(payload);
                setShowScanner(false);
              }}
            />
          </View>
        ) : null}

        {/* Filter Pills */}
        <View style={styles.filterPillsRow}>
          <Pressable
            style={[styles.filterPill, statusFilter === "all" && styles.filterPillActive]}
            onPress={() => setStatusFilter("all")}
          >
            <Text style={[styles.filterPillText, statusFilter === "all" && styles.filterPillTextActive]}>
              All ({sourceRows.length})
            </Text>
          </Pressable>
          <Pressable
            style={[styles.filterPill, statusFilter === "open" && styles.filterPillActive]}
            onPress={() => setStatusFilter("open")}
          >
            <Text style={[styles.filterPillText, statusFilter === "open" && styles.filterPillTextActive]}>
              Completed ({sourceRows.filter((r) => !r.isPartPayment).length})
            </Text>
          </Pressable>
          <Pressable
            style={[styles.filterPill, statusFilter === "part" && styles.filterPillActive]}
            onPress={() => setStatusFilter("part")}
          >
            <Text style={[styles.filterPillText, statusFilter === "part" && styles.filterPillTextActive]}>
              Part Payment ({sourceRows.filter((r) => r.isPartPayment).length})
            </Text>
          </Pressable>
        </View>
      </SectionCard>

      {/* Orders List */}
      <SectionCard>
        <View style={styles.listHeaderRow}>
          <Text style={styles.sectionTitle}>Order History</Text>
          {loading ? <ActivityIndicator size="small" color={Colors.primaryBlue} /> : null}
        </View>

        <View style={styles.ordersList}>
          {filteredRows.map((order) => (
            <Pressable
              key={order.id}
              style={({ pressed }) => [styles.orderCard, pressed && styles.orderCardPressed]}
              onPress={() => router.push(`/pos/receipt/${order.id}`)}
            >
              {/* Left Order Icon & Info */}
              <View style={styles.orderLeft}>
                <View style={[styles.orderIconWrap, order.isPartPayment && styles.orderIconWrapPart]}>
                  <Ionicons
                    name={order.isPartPayment ? "pie-chart-outline" : "receipt-outline"}
                    size={22}
                    color={order.isPartPayment ? Colors.accentOrange : Colors.primaryBlue}
                  />
                </View>

                <View style={styles.orderMetaCol}>
                  <Text style={styles.orderNumberText} numberOfLines={1} ellipsizeMode="tail">
                    #{order.orderNumber}
                  </Text>

                  <Text style={styles.customerNameText} numberOfLines={1} ellipsizeMode="tail">
                    {order.customerName ? order.customerName : "Walk-in Customer"}
                    {order.customerPhone ? ` · ${order.customerPhone}` : ""}
                  </Text>

                  <View style={styles.orderSubRow}>
                    <Text style={styles.orderDateText}>{order.dateLabel}</Text>
                    <Text style={styles.orderUnitCount}>
                      · {order.itemCount} {order.itemCount === 1 ? "unit" : "units"}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Right Total, Status Badge & Chevron */}
              <View style={styles.orderRight}>
                <View style={[styles.statusBadge, order.isPartPayment ? styles.statusBadgePart : styles.statusBadgePaid]}>
                  <Text style={[styles.statusBadgeText, order.isPartPayment ? styles.statusTextPart : styles.statusTextPaid]}>
                    {order.isPartPayment ? "Part Paid" : "Paid"}
                  </Text>
                </View>
                <Text style={styles.orderTotalText}>
                  {currencySymbol} {order.total.toFixed(2)}
                </Text>
                {order.isPartPayment ? (
                  <Text style={styles.paidText}>Paid: {currencySymbol}{order.amountPaid.toFixed(2)}</Text>
                ) : null}
              </View>
            </Pressable>
          ))}

          {!loading && filteredRows.length === 0 ? (
            <View style={styles.emptyBox}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="document-text-outline" size={36} color={Colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>No Orders Found</Text>
              <Text style={styles.emptySubtitle}>
                {query ? "Try adjusting your search keywords." : "Create your first POS sale using the New Sale button."}
              </Text>
            </View>
          ) : null}
        </View>
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  headerAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primaryBlue,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    gap: 4,
  },
  headerAddText: {
    color: Colors.white,
    fontWeight: "700",
    fontSize: 13,
  },
  metricsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  metricCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textSecondary,
    textTransform: "uppercase",
  },
  metricValue: {
    fontSize: 20,
    fontWeight: "900",
    color: Colors.textPrimary,
    marginTop: 4,
  },
  scannerWrap: {
    marginTop: Spacing.sm,
    height: 180,
    borderRadius: Radius.card,
    overflow: "hidden",
  },
  filterPillsRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  filterPillActive: {
    backgroundColor: Colors.primaryBlue,
    borderColor: Colors.primaryBlue,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  filterPillTextActive: {
    color: Colors.white,
  },
  listHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.title,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  ordersList: {
    gap: Spacing.sm,
  },
  orderCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: "#f1f5f9",
  },
  orderCardPressed: {
    backgroundColor: "#f8fafc",
  },
  orderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  orderIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  orderIconWrapPart: {
    backgroundColor: "#fff7ed",
  },
  orderMetaCol: {
    flex: 1,
    gap: 2,
  },
  orderNumberText: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  customerNameText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  orderSubRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  orderDateText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  orderUnitCount: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  orderRight: {
    alignItems: "flex-end",
    gap: 2,
    marginLeft: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  statusBadgePaid: {
    backgroundColor: "#dcfce7",
  },
  statusBadgePart: {
    backgroundColor: "#ffedd5",
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "800",
  },
  statusTextPaid: {
    color: "#15803d",
  },
  statusTextPart: {
    color: "#c2410c",
  },
  orderTotalText: {
    fontSize: 15,
    fontWeight: "900",
    color: Colors.textPrimary,
  },
  paidText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.xl,
    gap: Spacing.xs,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: "center",
    maxWidth: 240,
  },
});
