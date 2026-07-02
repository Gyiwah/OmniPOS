import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { ReturnCard } from "@/src/components/molecules/ReturnCard";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { listReturns } from "@/src/features/returns/service";
import type { ReturnListRow } from "@/src/features/returns/types";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";

type DateFilter = "all" | "today" | "7d" | "30d";

const FILTER_LABEL: Record<DateFilter, string> = {
  all: "All dates",
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

function money(value: number, currency: string) {
  const symbol = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";
  return `${symbol} ${value.toFixed(2)}`;
}

export default function ReturnsScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const currency = useSettingsStore((s) => s.currency);
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
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
        money(row.amount, currency).toLowerCase().includes(q)
      );
    });
  }, [currency, dateFilter, query, rows]);

  return (
    <AppScrollScreen title="Returns">
      <PrimaryButton label="Process new return" onPress={() => router.push("/pos/add-return")} />

      <SectionCard>
        <TextInput
          label="Search returns"
          value={query}
          onChangeText={setQuery}
          placeholder="Search by order #, reason, amount, or ID"
          leftIcon={<Ionicons name="search" size={18} color={Colors.textMuted} />}
        />
        <View>
          <Pressable onPress={() => setFilterOpen((v) => !v)} style={styles.dropdown}>
            <Text style={styles.dropdownText}>Filter: {FILTER_LABEL[dateFilter]}</Text>
            <Ionicons
              name={filterOpen ? "chevron-up-outline" : "chevron-down-outline"}
              size={18}
              color={Colors.textSecondary}
            />
          </Pressable>
          {filterOpen ? (
            <View style={styles.dropdownMenu}>
              {(Object.keys(FILTER_LABEL) as DateFilter[]).map((option) => (
                <Pressable
                  key={option}
                  onPress={() => {
                    setDateFilter(option);
                    setFilterOpen(false);
                  }}
                  style={styles.dropdownItem}
                >
                  <Text style={[styles.dropdownItemText, option === dateFilter && styles.dropdownItemActive]}>
                    {FILTER_LABEL[option]}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>History</Text>
        <View style={styles.list}>
          {loading ? <Text style={styles.empty}>Loading returns...</Text> : null}
          {!loading &&
            filteredRows.map((r) => (
              <ReturnCard
                key={r.id}
                dateLabel={new Date(r.createdAt).toLocaleDateString()}
                itemCount={r.itemCount}
                totalRefundLabel={money(r.amount, currency)}
                summaryLabel={`${r.orderNumber}${r.reason ? ` · ${r.reason}` : ""}`}
                onPress={() => router.push(`/pos/return/${r.id}`)}
              />
            ))}
          {!loading && filteredRows.length === 0 ? (
            <Text style={styles.empty}>No returns match your filters.</Text>
          ) : null}
        </View>
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  list: {
    gap: Spacing.sm,
  },
  dropdown: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  dropdownText: {
    color: Colors.textPrimary,
    fontWeight: "600",
  },
  dropdownMenu: {
    marginTop: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: Colors.surface,
  },
  dropdownItem: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  dropdownItemText: {
    color: Colors.textSecondary,
  },
  dropdownItemActive: {
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
  empty: {
    marginTop: Spacing.xs,
    color: Colors.textMuted,
    textAlign: "center",
  },
});
