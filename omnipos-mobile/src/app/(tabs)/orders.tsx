import Ionicons from "@expo/vector-icons/Ionicons";
import { Q } from "@nozbe/watermelondb";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { BarcodeScanner } from "@/src/components/organisms/BarcodeScanner";
import { Colors } from "@/src/constants/colors";
import { usingLaravel } from "@/src/core/api/config";
import { api } from "@/src/core/api/client";
import { supabase } from "@/src/services/supabase";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { database } from "@/src/database";
import type Order from "@/src/database/models/Order";
import type OrderItem from "@/src/database/models/OrderItem";
import { synchronise } from "@/src/sync";
import { shareReportPdf } from "@/src/utils/receiptPdf";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";

type OrderFilter = "all" | "open" | "part" | "voided";
type OrderRecord = {
  id: string;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  dateLabel: string;
  sortAt: number;
  itemCount: number;
  total: number;
  amountPaid: number;
  isPartPayment: boolean;
  isVoided: boolean;
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
      // Read the full local history so offline and queued sales are never hidden.
      const orders = await database
        .get<Order>("orders")
        .query(
          Q.where("store_id", activeStoreId),
          Q.sortBy("created_at", Q.desc),
        )
        .fetch();

      // Count quantities from local lines for the locally available orders.
      const orderIds = orders.map((o) => o.id);
      const counts = new Map<string, number>();

      if (orderIds.length > 0) {
        const items = await database
          .get<OrderItem>("order_items")
          .query(Q.where("store_id", activeStoreId))
          .fetch();

        items.forEach((item) => {
          const id = item.orderId;
          counts.set(id, (counts.get(id) ?? 0) + 1);
        });
      }

      const localRows = orders.map((o) => {
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
            sortAt: Number(o.createdAt),
            itemCount: counts.get(String(o.id)) ?? 0,
            total,
            amountPaid: paid,
            isPartPayment,
            isVoided: o.status === "voided",
          };
        });

      let remoteRows: OrderRecord[] = [];
      if (usingLaravel) {
        try {
          const all: Array<{
            id: string;
            order_number: string;
            customer_name: string | null;
            customer_phone: string | null;
            client_created_at: string | null;
            total: string;
            amount_paid: string;
            status: string;
            items_count: number;
          }> = [];
          let page = 1;
          let lastPage = 1;
          do {
            const result = await api.get<{
              data: typeof all;
              meta?: { last_page?: number };
            }>("/api/orders", { per_page: 200, page });
            all.push(...(result.data ?? []));
            lastPage = result.meta?.last_page ?? page;
            page += 1;
          } while (page <= lastPage);

          remoteRows = all.map((order) => {
            const total = Number(order.total ?? 0);
            const amountPaid = Number(order.amount_paid ?? total);
            return {
              id: order.id,
              orderNumber: order.order_number,
              customerName: order.customer_name,
              customerPhone: order.customer_phone,
              dateLabel: new Date(order.client_created_at ?? "").toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
              sortAt: Date.parse(order.client_created_at ?? "") || 0,
              itemCount: Number(order.items_count ?? 0),
              total,
              amountPaid,
              isPartPayment: amountPaid + 0.0001 < total,
              isVoided: order.status === "voided",
            };
          });
        } catch {
          // A failed request should not hide sales already stored on this device.
        }
      } else {
        try {
          const all: Array<{
            id: string;
            order_number: string;
            customer_name: string | null;
            customer_phone: string | null;
            created_at: string;
            total: number;
            amount_paid: number;
            status: string;
          }> = [];
          let offset = 0;
          const pageSize = 1000;
          while (true) {
            const { data, error } = await supabase
              .from("orders")
              .select("id, order_number, customer_name, customer_phone, created_at, total, amount_paid, status")
              .eq("store_id", activeStoreId)
              .order("created_at", { ascending: false })
              .range(offset, offset + pageSize - 1)
              .returns<typeof all>();
            if (error) throw error;
            const page = data ?? [];
            all.push(...page);
            if (page.length < pageSize) break;
            offset += pageSize;
          }

          const itemRows: Array<{ order_id: string }> = [];
          let itemOffset = 0;
          while (true) {
            const { data, error } = await supabase
              .from("order_items")
              .select("order_id")
              .eq("store_id", activeStoreId)
              .range(itemOffset, itemOffset + pageSize - 1)
              .returns<typeof itemRows>();
            if (error) throw error;
            const page = data ?? [];
            itemRows.push(...page);
            if (page.length < pageSize) break;
            itemOffset += pageSize;
          }
          const serverCounts = new Map<string, number>();
          for (const item of itemRows ?? []) {
            const orderId = String(item.order_id);
            serverCounts.set(orderId, (serverCounts.get(orderId) ?? 0) + 1);
          }

          remoteRows = all.map((order) => {
            const total = Number(order.total ?? 0);
            const amountPaid = Number(order.amount_paid ?? total);
            return {
              id: order.id,
              orderNumber: order.order_number,
              customerName: order.customer_name,
              customerPhone: order.customer_phone,
              dateLabel: new Date(order.created_at).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
              sortAt: Date.parse(order.created_at) || 0,
              itemCount: serverCounts.get(order.id) ?? 0,
              total,
              amountPaid,
              isPartPayment: amountPaid + 0.0001 < total,
              isVoided: order.status === "voided",
            };
          });
        } catch {
          // Keep local history usable when Supabase is unreachable.
        }
      }

      const merged = new Map(remoteRows.map((order) => [order.id, order]));
      for (const order of localRows) merged.set(order.id, order);
      setSourceRows(
        [...merged.values()].sort((a, b) => b.sortAt - a.sortAt),
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
      void synchronise(activeStoreId).then(() => {
        void loadLocalOrders();
      });
    }
  }, [activeStoreId, loadLocalOrders]);

  const handleRefresh = async () => {
    if (!activeStoreId) return;
    setRefreshing(true);
    try {
      await synchronise(activeStoreId);
      await loadLocalOrders();
    } finally {
      setRefreshing(false);
    }
  };

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sourceRows.filter((order) => {
      if (statusFilter === "voided" && !order.isVoided) return false;
      if (statusFilter === "voided" && !order.isVoided) return false;
      if (statusFilter === "part" && (!order.isPartPayment || order.isVoided)) return false;
      if (statusFilter === "open" && (order.isPartPayment || order.isVoided)) return false;
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
        <View style={styles.headerActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Print or share filtered orders as PDF"
          style={({ pressed }) => [styles.headerPrintBtn, pressed && { opacity: 0.7 }]}
          onPress={() => void shareReportPdf({
            title: "Orders & Sales",
            fileName: "Orders-and-Sales.pdf",
            columns: ["Receipt", "When", "Customer", "Items", "Total", "Paid", "Status"],
            rows: filteredRows.map((order) => [
              order.orderNumber,
              order.dateLabel,
              order.customerName ?? "Walk-in",
              String(order.itemCount),
              `${currencySymbol} ${order.total.toFixed(2)}`,
              `${currencySymbol} ${order.amountPaid.toFixed(2)}`,
              order.isVoided ? "Voided" : order.isPartPayment ? "Part paid" : "Paid",
            ]),
          })}
        >
          <Ionicons name="print-outline" size={20} color={Colors.primaryBlue} />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.headerAddBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.push("/pos/add-order")}
        >
          <Ionicons name="add" size={18} color={Colors.white} />
          <Text style={styles.headerAddText}>New Sale</Text>
        </Pressable>
        </View>
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
              Completed ({sourceRows.filter((r) => !r.isPartPayment && !r.isVoided).length})
            </Text>
          </Pressable>
          <Pressable
            style={[styles.filterPill, statusFilter === "part" && styles.filterPillActive]}
            onPress={() => setStatusFilter("part")}
          >
            <Text style={[styles.filterPillText, statusFilter === "part" && styles.filterPillTextActive]}>
              Part Payment ({sourceRows.filter((r) => r.isPartPayment && !r.isVoided).length})
            </Text>
          </Pressable>
          <Pressable
            style={[styles.filterPill, statusFilter === "voided" && styles.filterPillActive]}
            onPress={() => setStatusFilter("voided")}
          >
            <Text style={[styles.filterPillText, statusFilter === "voided" && styles.filterPillTextActive]}>
              Voided ({sourceRows.filter((r) => r.isVoided).length})
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
                      · {order.itemCount} {order.itemCount === 1 ? "item" : "items"}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Right Total, Status Badge & Chevron */}
              <View style={styles.orderRight}>
                <View style={[styles.statusBadge, order.isVoided ? styles.statusBadgeVoid : order.isPartPayment ? styles.statusBadgePart : styles.statusBadgePaid]}>
                  <Text style={[styles.statusBadgeText, order.isVoided ? styles.statusTextVoid : order.isPartPayment ? styles.statusTextPart : styles.statusTextPaid]}>
                    {order.isVoided ? "Voided" : order.isPartPayment ? "Part Paid" : "Paid"}
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  headerPrintBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primaryBluePale,
  },
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
    flexWrap: "wrap",
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
  statusBadgeVoid: {
    backgroundColor: "#fee2e2",
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
  statusTextVoid: {
    color: "#b91c1c",
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
