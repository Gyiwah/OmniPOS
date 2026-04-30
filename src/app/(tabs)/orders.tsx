import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { OrderCard } from "@/src/components/molecules/OrderCard";
import { BarcodeScanner } from "@/src/components/organisms/BarcodeScanner";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { MOCK_ORDERS } from "@/src/lib/uiMock";

type OrderFilter = "all" | "open" | "part";

export default function OrdersScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OrderFilter>("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MOCK_ORDERS.filter((order) => {
      if (statusFilter === "part" && !order.isPartPayment) return false;
      if (statusFilter === "open" && order.isPartPayment) return false;
      if (!q) return true;
      return (
        (order.customerName ?? "").toLowerCase().includes(q) ||
        order.dateLabel.toLowerCase().includes(q) ||
        order.totalLabel.toLowerCase().includes(q)
      );
    });
  }, [query, statusFilter]);

  return (
    <AppScrollScreen title="Orders" subtitle="Open and recent sales.">
      <PrimaryButton label="New order" onPress={() => router.push("/pos/add-order")} />

      <SectionCard>
        <TextInput
          label="Search orders"
          value={query}
          onChangeText={setQuery}
          placeholder="Customer, date, or amount"
          leftIcon={<Ionicons name="search" size={18} color={Colors.textMuted} />}
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
            label="Scan order barcode to search"
            onScan={(payload) => {
              setQuery(payload);
              setShowScanner(false);
            }}
          />
        ) : null}

        <View style={styles.filterRow}>
          <Pressable
            style={[styles.filterPill, statusFilter === "all" && styles.filterPillActive]}
            onPress={() => setStatusFilter("all")}
          >
            <Text style={[styles.filterText, statusFilter === "all" && styles.filterTextActive]}>All</Text>
          </Pressable>
          <Pressable
            style={[styles.filterPill, statusFilter === "open" && styles.filterPillActive]}
            onPress={() => setStatusFilter("open")}
          >
            <Text style={[styles.filterText, statusFilter === "open" && styles.filterTextActive]}>Completed</Text>
          </Pressable>
          <Pressable
            style={[styles.filterPill, statusFilter === "part" && styles.filterPillActive]}
            onPress={() => setStatusFilter("part")}
          >
            <Text style={[styles.filterText, statusFilter === "part" && styles.filterTextActive]}>Part payment</Text>
          </Pressable>
        </View>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Order history</Text>
        <View style={styles.list}>
          {rows.map((order) => (
            <OrderCard
              key={order.id}
              thumbnails={order.thumbnails}
              customerName={order.customerName}
              dateLabel={order.dateLabel}
              itemCount={order.itemCount}
              totalLabel={order.totalLabel}
              isPartPayment={order.isPartPayment}
              onPress={() => router.push("/pos/order-info")}
            />
          ))}
          {rows.length === 0 ? <Text style={styles.empty}>No orders match your filters.</Text> : null}
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
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  filterPill: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 40,
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
