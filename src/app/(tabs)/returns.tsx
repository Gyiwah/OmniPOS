import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { TextInput } from "@/src/components/atoms/TextInput";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { listReturns } from "@/src/features/returns/service";
import type { ReturnListRow } from "@/src/features/returns/types";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";

type DateFilter = "all" | "today" | "7d" | "30d";

export default function ReturnsScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const currency = useSettingsStore((s) => s.currency);
  const symbol = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";

  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [rows, setRows] = useState<ReturnListRow[]>([]);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      async function loadReturns() {
        if (!activeStoreId) {
          if (mounted) setRows([]);
          return;
        }
        setLoading(true);
        try {
          const data = await listReturns(activeStoreId);
          if (mounted) setRows(data);
        } catch {
          if (mounted) setRows([]);
        } finally {
          if (mounted) setLoading(false);
        }
      }
      void loadReturns();
      return () => {
        mounted = false;
      };
    }, [activeStoreId]),
  );

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    return rows.filter((row) => {
      const createdAt = new Date(row.createdAt);
      if (dateFilter === "today" && createdAt < startOfToday) return false;
      if (dateFilter === "7d" && createdAt < sevenDaysAgo) return false;
      if (dateFilter === "30d" && createdAt < thirtyDaysAgo) return false;

      if (!q) return true;
      return (
        row.orderNumber.toLowerCase().includes(q) ||
        row.reason.toLowerCase().includes(q) ||
        row.id.toLowerCase().includes(q) ||
        row.amount.toString().includes(q)
      );
    });
  }, [dateFilter, query, rows]);

  const totalRefundAmount = useMemo(
    () => filteredRows.reduce((sum, r) => sum + r.amount, 0),
    [filteredRows],
  );

  return (
    <AppScrollScreen
      title="Returns & Refunds"
      subtitle="Track customer returns, restocked units, and refunds."
      right={
        <Pressable
          style={({ pressed }) => [styles.headerAddBtn, pressed && { opacity: 0.8 }]}
          onPress={() => router.push("/pos/add-return")}
        >
          <Ionicons name="add" size={18} color={Colors.white} />
          <Text style={styles.headerAddText}>New Return</Text>
        </Pressable>
      }
    >
      {/* Top Metrics Row */}
      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Total Returns</Text>
          <Text style={styles.metricValue}>{filteredRows.length}</Text>
          <Text style={styles.metricSub}>Cases logged</Text>
        </View>

        <View style={[styles.metricCard, { backgroundColor: "#fff1f2", borderColor: "#fecdd3" }]}>
          <Text style={[styles.metricLabel, { color: "#e11d48" }]}>Refund Total</Text>
          <Text style={[styles.metricValue, { color: "#be123c" }]}>
            {symbol} {totalRefundAmount.toFixed(2)}
          </Text>
          <Text style={styles.metricSub}>Amount refunded</Text>
        </View>
      </View>

      {/* Search & Date Filter Section */}
      <SectionCard>
        <TextInput
          label="Search Returns"
          value={query}
          onChangeText={setQuery}
          placeholder="Order #, reason, amount..."
          leftIcon={<Ionicons name="search-outline" size={18} color={Colors.textMuted} />}
        />

        <View style={styles.filterPillsRow}>
          <Pressable
            style={[styles.filterPill, dateFilter === "all" && styles.filterPillActive]}
            onPress={() => setDateFilter("all")}
          >
            <Text style={[styles.filterPillText, dateFilter === "all" && styles.filterPillTextActive]}>
              All
            </Text>
          </Pressable>
          <Pressable
            style={[styles.filterPill, dateFilter === "today" && styles.filterPillActive]}
            onPress={() => setDateFilter("today")}
          >
            <Text style={[styles.filterPillText, dateFilter === "today" && styles.filterPillTextActive]}>
              Today
            </Text>
          </Pressable>
          <Pressable
            style={[styles.filterPill, dateFilter === "7d" && styles.filterPillActive]}
            onPress={() => setDateFilter("7d")}
          >
            <Text style={[styles.filterPillText, dateFilter === "7d" && styles.filterPillTextActive]}>
              7 Days
            </Text>
          </Pressable>
          <Pressable
            style={[styles.filterPill, dateFilter === "30d" && styles.filterPillActive]}
            onPress={() => setDateFilter("30d")}
          >
            <Text style={[styles.filterPillText, dateFilter === "30d" && styles.filterPillTextActive]}>
              30 Days
            </Text>
          </Pressable>
        </View>
      </SectionCard>

      {/* Returns List Section */}
      <SectionCard>
        <View style={styles.listHeaderRow}>
          <Text style={styles.sectionTitle}>Processed Returns</Text>
          {loading ? <ActivityIndicator size="small" color={Colors.primaryBlue} /> : null}
        </View>

        <View style={styles.returnsList}>
          {filteredRows.map((item) => (
            <Pressable
              key={item.id}
              style={({ pressed }) => [styles.returnCard, pressed && styles.returnCardPressed]}
              onPress={() => router.push(`/pos/return/${item.id}`)}
            >
              <View style={styles.returnLeft}>
                <View style={styles.returnIconWrap}>
                  <Ionicons name="refresh-outline" size={22} color={Colors.danger} />
                </View>

                <View style={styles.returnInfo}>
                  <Text style={styles.orderNumber} numberOfLines={1}>
                    #{item.orderNumber}
                  </Text>
                  <Text style={styles.returnReason} numberOfLines={1}>
                    Reason: {item.reason}
                  </Text>
                  <Text style={styles.returnDate}>
                    {new Date(item.createdAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
              </View>

              <View style={styles.returnRight}>
                <View style={styles.refundBadge}>
                  <Text style={styles.refundBadgeText}>Refund</Text>
                </View>
                <Text style={styles.returnAmount}>
                  -{symbol} {item.amount.toFixed(2)}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
              </View>
            </Pressable>
          ))}

          {!loading && filteredRows.length === 0 ? (
            <View style={styles.emptyBox}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="refresh-circle-outline" size={36} color={Colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>No Returns Found</Text>
              <Text style={styles.emptySubtitle}>
                {query ? "No refund records match your search." : "Customer returns will appear here when processed."}
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
    backgroundColor: Colors.danger,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    gap: 4,
  },
  headerAddText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: "700",
  },
  metricsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  metricCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
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
  metricSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  filterPillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  filterPill: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.surface,
  },
  filterPillActive: {
    borderColor: Colors.danger,
    backgroundColor: "#fff1f2",
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  filterPillTextActive: {
    color: Colors.danger,
    fontWeight: "800",
  },
  listHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  sectionTitle: {
    ...Typography.title,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  returnsList: {
    gap: Spacing.xs,
  },
  returnCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  returnCardPressed: {
    backgroundColor: "#f8fafc",
    transform: [{ scale: 0.99 }],
  },
  returnLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  returnIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#fff1f2",
    alignItems: "center",
    justifyContent: "center",
  },
  returnInfo: {
    flex: 1,
    gap: 2,
  },
  orderNumber: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  refundBadge: {
    backgroundColor: "#fee2e2",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: "flex-end",
  },
  refundBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#dc2626",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  returnReason: {
    fontSize: 13,
    color: Colors.textPrimary,
    fontWeight: "600",
  },
  returnDate: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  returnRight: {
    alignItems: "flex-end",
    justifyContent: "center",
    paddingLeft: Spacing.xs,
    gap: 3,
  },
  returnAmount: {
    fontSize: 15,
    fontWeight: "900",
    color: Colors.danger,
  },
  emptyBox: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
    gap: Spacing.xs,
  },
  emptyIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: "center",
    paddingHorizontal: Spacing.lg,
  },
});
