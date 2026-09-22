import Ionicons from "@expo/vector-icons/Ionicons";
import { Q } from "@nozbe/watermelondb";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { database } from "@/src/database";
import type Customer from "@/src/database/models/Customer";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";
import { synchronise } from "@/src/sync";

type CustomerItem = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  totalSpend: number;
  outstandingBalance: number;
};

const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2"];

export default function CustomersScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const currency = useSettingsStore((s) => s.currency);
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "unpaid">("all");

  const sym = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";

  const loadCustomers = useCallback(async () => {
    if (!activeStoreId) {
      setCustomers([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await database
        .get<Customer>("customers")
        .query(Q.where("store_id", activeStoreId))
        .fetch();

      setCustomers(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          phone: r.phone,
          email: r.email,
          totalSpend: Number(r.totalSpend ?? 0),
          outstandingBalance: Number(r.outstandingBalance ?? 0),
        })),
      );

      // Trigger background sync
      void synchronise(activeStoreId);
    } catch {
      // ignore load errors
    } finally {
      setLoading(false);
    }
  }, [activeStoreId]);

  useFocusEffect(
    useCallback(() => {
      void loadCustomers();
    }, [loadCustomers])
  );

  const aggregateSpend = useMemo(
    () => customers.reduce((sum, c) => sum + c.totalSpend, 0),
    [customers],
  );

  const totalOutstanding = useMemo(
    () => customers.reduce((sum, c) => sum + c.outstandingBalance, 0),
    [customers],
  );

  const unpaidCount = useMemo(
    () => customers.filter((c) => c.outstandingBalance > 0.01).length,
    [customers],
  );

  const filtered = useMemo(() => {
    let result = customers;
    if (filterMode === "unpaid") {
      result = result.filter((c) => c.outstandingBalance > 0.01);
    }
    const q = search.trim().toLowerCase();
    if (!q) return result;
    return result.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)),
    );
  }, [customers, filterMode, search]);

  return (
    <AppScrollScreen
      showBack
      title="Customer CRM"
      subtitle="Client directory, lifetime spend & balance tracking"
      right={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add New Client"
          style={({ pressed }) => [styles.headerAddBtn, pressed && { opacity: 0.8 }]}
          onPress={() => router.push("/customers/add")}
        >
          <Ionicons name="person-add" size={15} color={Colors.white} />
          <Text style={styles.headerAddText}>Add Client</Text>
        </Pressable>
      }
    >
      {/* Metrics Row */}
      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Total Clients</Text>
          <Text style={styles.metricValue}>{customers.length}</Text>
          <Text style={styles.metricSub}>Registered profiles</Text>
        </View>

        <View style={[styles.metricCard, { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" }]}>
          <Text style={[styles.metricLabel, { color: "#16a34a" }]}>Lifetime Value</Text>
          <Text style={[styles.metricValue, { color: "#15803d" }]} numberOfLines={1}>
            {sym} {aggregateSpend.toFixed(2)}
          </Text>
          <Text style={styles.metricSub}>Cumulative spend</Text>
        </View>

        {totalOutstanding > 0 ? (
          <Pressable
            style={[
              styles.metricCard,
              { backgroundColor: "#fff1f2", borderColor: "#fecdd3" },
            ]}
            onPress={() => setFilterMode("unpaid")}
          >
            <Text style={[styles.metricLabel, { color: Colors.danger }]}>Unpaid Debt</Text>
            <Text style={[styles.metricValue, { color: "#b91c1c" }]} numberOfLines={1}>
              {sym} {totalOutstanding.toFixed(2)}
            </Text>
            <Text style={[styles.metricSub, { color: "#dc2626" }]}>
              {unpaidCount} client(s) due
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Search Input & Filter Pills */}
      <SectionCard>
        <TextInput
          label="Search Directory"
          value={search}
          onChangeText={setSearch}
          placeholder="Client name, phone, or email..."
          leftIcon={<Ionicons name="search-outline" size={18} color={Colors.textMuted} />}
          rightIcon={
            search ? (
              <Pressable onPress={() => setSearch("")} hitSlop={10}>
                <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
              </Pressable>
            ) : undefined
          }
        />

        <View style={styles.filterTabsRow}>
          <Pressable
            style={[
              styles.filterTab,
              filterMode === "all" && styles.filterTabActive,
            ]}
            onPress={() => setFilterMode("all")}
          >
            <Text
              style={[
                styles.filterTabText,
                filterMode === "all" && styles.filterTabTextActive,
              ]}
            >
              All Clients ({customers.length})
            </Text>
          </Pressable>

          {unpaidCount > 0 ? (
            <Pressable
              style={[
                styles.filterTab,
                filterMode === "unpaid" && styles.filterTabUnpaidActive,
              ]}
              onPress={() => setFilterMode("unpaid")}
            >
              <Ionicons
                name="alert-circle"
                size={14}
                color={filterMode === "unpaid" ? Colors.white : "#dc2626"}
              />
              <Text
                style={[
                  styles.filterTabText,
                  filterMode === "unpaid" && styles.filterTabTextActive,
                  filterMode !== "unpaid" && { color: "#dc2626" },
                ]}
              >
                With Unpaid Balance ({unpaidCount})
              </Text>
            </Pressable>
          ) : null}
        </View>
      </SectionCard>

      {/* Customer List */}
      <SectionCard>
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>
            {filterMode === "unpaid" ? "Clients with Debt" : "Client Directory"} ({filtered.length})
          </Text>
          {loading ? <ActivityIndicator size="small" color={Colors.primaryBlue} /> : null}
        </View>

        <View style={styles.customerList}>
          {filtered.map((item, idx) => {
            const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];
            const hasDebt = item.outstandingBalance > 0.01;

            return (
              <Pressable
                key={item.id}
                style={({ pressed }) => [
                  styles.customerCard,
                  hasDebt && styles.customerCardDebt,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => router.push(`/customers/${item.id}`)}
              >
                <View style={[styles.avatarWrap, { backgroundColor: `${avatarColor}15` }]}>
                  <Text style={[styles.avatarInitials, { color: avatarColor }]}>
                    {item.name.slice(0, 2).toUpperCase()}
                  </Text>
                </View>

                <View style={styles.customerDetails}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={styles.customerName}>{item.name}</Text>
                    {hasDebt ? (
                      <View style={styles.debtPill}>
                        <Text style={styles.debtPillText}>Due</Text>
                      </View>
                    ) : null}
                  </View>

                  {item.phone ? (
                    <View style={styles.metaRow}>
                      <Ionicons name="call-outline" size={12} color={Colors.textMuted} />
                      <Text style={styles.metaText}>{item.phone}</Text>
                    </View>
                  ) : null}
                  {item.email ? (
                    <View style={styles.metaRow}>
                      <Ionicons name="mail-outline" size={12} color={Colors.textMuted} />
                      <Text style={styles.metaText}>{item.email}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.spendWrap}>
                  <Text style={styles.spendLabel}>Total Spend</Text>
                  <Text style={styles.spendValue}>
                    {sym} {item.totalSpend.toFixed(2)}
                  </Text>
                  {hasDebt ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <Text style={styles.cardDebtText}>
                        Due: {sym} {item.outstandingBalance.toFixed(2)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
              </Pressable>
            );
          })}

          {!loading && filtered.length === 0 ? (
            <View style={styles.emptyBox}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="people-outline" size={36} color={Colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>No Customers Found</Text>
              <Text style={styles.emptySubtitle}>
                {search
                  ? "No clients matched your search query."
                  : filterMode === "unpaid"
                  ? "No clients have an outstanding debt balance."
                  : "Tap 'Add Client' to register your first customer."}
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
    paddingVertical: 7,
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
    gap: Spacing.xs,
  },
  metricCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.sm + 2,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textSecondary,
    textTransform: "uppercase",
  },
  metricValue: {
    fontSize: 17,
    fontWeight: "900",
    color: Colors.textPrimary,
    marginTop: 4,
  },
  metricSub: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
  },
  filterTabsRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: Spacing.xs,
  },
  filterTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  filterTabActive: {
    backgroundColor: Colors.primaryBlue,
    borderColor: Colors.primaryBlue,
  },
  filterTabUnpaidActive: {
    backgroundColor: "#dc2626",
    borderColor: "#dc2626",
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  filterTabTextActive: {
    color: Colors.white,
    fontWeight: "700",
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
  customerList: {
    gap: Spacing.xs,
  },
  customerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    gap: Spacing.sm,
  },
  customerCardDebt: {
    borderColor: "#fecdd3",
    backgroundColor: "#fffdfd",
  },
  avatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: {
    fontSize: 15,
    fontWeight: "800",
  },
  customerDetails: {
    flex: 1,
    gap: 2,
  },
  customerName: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  debtPill: {
    backgroundColor: "#fee2e2",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  debtPillText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#dc2626",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  spendWrap: {
    alignItems: "flex-end",
  },
  spendLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: Colors.textMuted,
    textTransform: "uppercase",
  },
  spendValue: {
    fontSize: 14,
    fontWeight: "900",
    color: Colors.textPrimary,
    marginTop: 2,
  },
  cardDebtText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#dc2626",
    marginTop: 1,
  },
  emptyBox: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
    gap: Spacing.xs,
  },
  emptyIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
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
    paddingHorizontal: Spacing.lg,
  },
});
