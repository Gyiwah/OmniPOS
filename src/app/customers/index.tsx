import Ionicons from "@expo/vector-icons/Ionicons";
import { Q } from "@nozbe/watermelondb";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

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
import { runSyncCycle } from "@/src/sync/syncEngine";

type CustomerItem = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  totalSpend: number;
  outstandingBalance: number;
};

export default function CustomersScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const currency = useSettingsStore((s) => s.currency);
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [loading, setLoading] = useState(false);

  const sym = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";

  const loadCustomers = useCallback(async () => {
    if (!activeStoreId) {
      setCustomers([]);
      return;
    }
    setLoading(true);
    try {
      await runSyncCycle(activeStoreId);
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
    } catch {
      // ignore load errors
    } finally {
      setLoading(false);
    }
  }, [activeStoreId]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const filtered = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q));
  });

  return (
    <AppScrollScreen
      showBack
      title="Customer CRM"
      subtitle="Manage registered store customers and track lifetime spend."
      right={
        <Pressable hitSlop={8} onPress={() => router.push("/customers/add")}>
          <Ionicons name="person-add-outline" size={22} color={Colors.primaryBlue} />
        </Pressable>
      }
    >
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search customers..."
        leftIcon={<Ionicons name="search-outline" size={20} color={Colors.textMuted} />}
      />

      {loading && customers.length === 0 ? (
        <Text style={styles.emptyText}>Loading customers...</Text>
      ) : filtered.length === 0 ? (
        <SectionCard>
          <View style={styles.emptyBox}>
            <Ionicons name="people-outline" size={40} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No customers found</Text>
            <Text style={styles.emptySub}>Tap '+' above to add your first customer.</Text>
          </View>
        </SectionCard>
      ) : (
        filtered.map((item) => (
          <SectionCard key={item.id}>
            <View style={styles.cardHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.metaBox}>
                <Text style={styles.custName}>{item.name}</Text>
                {item.phone ? <Text style={styles.custPhone}>{item.phone}</Text> : null}
                {item.email ? <Text style={styles.custEmail}>{item.email}</Text> : null}
              </View>
              <View style={styles.spendBox}>
                <Text style={styles.spendLabel}>Total Spend</Text>
                <Text style={styles.spendValue}>
                  {sym} {item.totalSpend.toFixed(2)}
                </Text>
              </View>
            </View>
          </SectionCard>
        ))
      )}
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  emptyText: { color: Colors.textMuted, textAlign: "center", marginTop: 20 },
  emptyBox: { alignItems: "center", paddingVertical: Spacing.xl, gap: Spacing.xs },
  emptyTitle: { ...Typography.title, color: Colors.textPrimary },
  emptySub: { color: Colors.textMuted, fontSize: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontWeight: "700", color: Colors.primaryBlue },
  metaBox: { flex: 1, gap: 2 },
  custName: { fontSize: 16, fontWeight: "700", color: Colors.textPrimary },
  custPhone: { fontSize: 13, color: Colors.textSecondary },
  custEmail: { fontSize: 12, color: Colors.textMuted },
  spendBox: { alignItems: "flex-end" },
  spendLabel: { fontSize: 11, color: Colors.textMuted, textTransform: "uppercase" },
  spendValue: { fontSize: 16, fontWeight: "800", color: Colors.success },
});
