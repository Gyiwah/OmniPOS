import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { ReturnCard } from "@/src/components/molecules/ReturnCard";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { Colors } from "@/src/constants/colors";
import Ionicons from "@expo/vector-icons/Ionicons";
import { supabase } from "@/src/services/supabase";
import { useStoreSlice } from "@/src/store/storeSlice";

type DateFilter = "all" | "today" | "7d" | "30d";

const FILTER_LABEL: Record<DateFilter, string> = {
  all: "All dates",
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

export default function ReturnsScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [rows, setRows] = useState<
    { id: string; dateLabel: string; itemCount: number; totalRefundLabel: string; thumbnail: string | null }[]
  >([]);

  useEffect(() => {
    let mounted = true;
    async function loadReturns() {
      if (!activeStoreId) return;
      const { data: returns } = await supabase
        .from("returns")
        .select("id, order_id, amount, created_at")
        .eq("store_id", activeStoreId)
        .order("created_at", { ascending: false })
        .limit(120);
      const orderIds = (returns ?? []).map((r) => String(r.order_id));
      const counts = new Map<string, number>();
      if (orderIds.length > 0) {
        const { data: items } = await supabase
          .from("order_items")
          .select("order_id, quantity")
          .eq("store_id", activeStoreId)
          .in("order_id", orderIds);
        (items ?? []).forEach((item) => {
          const key = String(item.order_id);
          counts.set(key, (counts.get(key) ?? 0) + Number(item.quantity ?? 0));
        });
      }
      if (!mounted) return;
      setRows(
        (returns ?? []).map((r) => ({
          id: String(r.id),
          dateLabel: new Date(String(r.created_at)).toLocaleDateString(),
          itemCount: counts.get(String(r.order_id)) ?? 1,
          totalRefundLabel: `₵ ${Number(r.amount ?? 0).toFixed(2)}`,
          thumbnail: null,
        })),
      );
    }
    void loadReturns();
    return () => {
      mounted = false;
    };
  }, [activeStoreId]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = rows.filter(
      (row) =>
        !q ||
        row.dateLabel.toLowerCase().includes(q) ||
        row.totalRefundLabel.toLowerCase().includes(q) ||
        row.id.toLowerCase().includes(q),
    );

    if (dateFilter === "today") return base.slice(0, 1);
    if (dateFilter === "7d") return base.slice(0, 2);
    if (dateFilter === "30d") return base;
    return base;
  }, [dateFilter, query, rows]);

  return (
    <AppScrollScreen title="Returns">
      <PrimaryButton label="Process new return" onPress={() => router.push("/pos/add-return")} />

      <SectionCard>
        <TextInput
          label="Search returns"
          value={query}
          onChangeText={setQuery}
          placeholder="Search by date, amount, or ID"
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
          {filteredRows.map((r) => (
            <ReturnCard
              key={r.id}
              thumbnail={r.thumbnail}
              dateLabel={r.dateLabel}
              itemCount={r.itemCount}
              totalRefundLabel={r.totalRefundLabel}
              onPress={() => {}}
            />
          ))}
          {filteredRows.length === 0 ? <Text style={styles.empty}>No returns match your filters.</Text> : null}
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
