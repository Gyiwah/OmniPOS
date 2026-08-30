import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Q } from "@nozbe/watermelondb";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { database } from "@/src/database";
import type Customer from "@/src/database/models/Customer";
import type Order from "@/src/database/models/Order";
import { supabase } from "@/src/services/supabase";
import { useOrderDraftStore } from "@/src/store/orderDraftStore";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";

type OrderItemSummary = {
  id: string;
  orderNumber: string;
  createdAt: number | string;
  total: number;
  amountPaid: number;
  status: string;
  paymentMethod: string;
};

export default function CustomerProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const currency = useSettingsStore((s) => s.currency);
  const setDraftCustomer = useOrderDraftStore((s) => s.setCustomer);

  const [customer, setCustomer] = useState<{
    id: string;
    name: string;
    phone?: string;
    email?: string;
    notes?: string;
    totalSpend: number;
    outstandingBalance: number;
    createdAt?: number;
  } | null>(null);

  const [orders, setOrders] = useState<OrderItemSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const sym = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";

  const loadProfile = useCallback(async () => {
    if (!activeStoreId || !id) return;
    setLoading(true);
    try {
      // 1. Fetch Customer from SQLite
      let custRecord: Customer | null = null;
      try {
        custRecord = await database.get<Customer>("customers").find(id);
      } catch {
        const matches = await database
          .get<Customer>("customers")
          .query(Q.where("store_id", activeStoreId), Q.where("id", id))
          .fetch();
        custRecord = matches[0] ?? null;
      }

      if (custRecord) {
        setCustomer({
          id: custRecord.id,
          name: custRecord.name,
          phone: custRecord.phone,
          email: custRecord.email,
          notes: custRecord.notes,
          totalSpend: Number(custRecord.totalSpend ?? 0),
          outstandingBalance: Number(custRecord.outstandingBalance ?? 0),
          createdAt: custRecord.updatedAt,
        });
      }

      // 2. Fetch Orders for this Customer from SQLite
      const localOrders = await database
        .get<Order>("orders")
        .query(
          Q.where("store_id", activeStoreId),
          Q.or(
            Q.where("customer_id", id),
            custRecord?.phone ? Q.where("customer_phone", custRecord.phone) : Q.where("customer_id", id),
            custRecord?.name ? Q.where("customer_name", custRecord.name) : Q.where("customer_id", id)
          )
        )
        .fetch();

      const localOrderSummaries: OrderItemSummary[] = localOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        total: Number(o.total ?? 0),
        amountPaid: Number(o.amountPaid ?? 0),
        status: o.status,
        paymentMethod: o.paymentMethod,
      }));

      // 3. Check Supabase if connected
      try {
        let qb = supabase
          .from("orders")
          .select("id, order_number, created_at, total, amount_paid, status, payment_method")
          .eq("store_id", activeStoreId);

        if (custRecord?.phone) {
          qb = qb.or(`customer_id.eq.${id},customer_phone.eq.${custRecord.phone}`);
        } else {
          qb = qb.eq("customer_id", id);
        }

        const { data: cloudOrders } = await qb.order("created_at", { ascending: false });

        if (cloudOrders && cloudOrders.length > 0) {
          const mergedMap = new Map<string, OrderItemSummary>();
          for (const lo of localOrderSummaries) {
            mergedMap.set(lo.orderNumber, lo);
          }
          for (const co of cloudOrders) {
            mergedMap.set(co.order_number, {
              id: co.id,
              orderNumber: co.order_number,
              createdAt: co.created_at,
              total: Number(co.total ?? 0),
              amountPaid: Number(co.amount_paid ?? 0),
              status: co.status,
              paymentMethod: co.payment_method,
            });
          }
          setOrders(Array.from(mergedMap.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        } else {
          setOrders(localOrderSummaries);
        }
      } catch {
        setOrders(localOrderSummaries);
      }
    } catch (err) {
      if (__DEV__) console.warn("[OmniPOS] Error loading customer profile:", err);
    } finally {
      setLoading(false);
    }
  }, [activeStoreId, id]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const totalCalculatedSpend = useMemo(() => {
    if (orders.length > 0) {
      return orders.reduce((sum, o) => sum + o.total, 0);
    }
    return customer?.totalSpend ?? 0;
  }, [customer?.totalSpend, orders]);

  const totalUnpaidBalance = useMemo(() => {
    return orders.reduce((sum, o) => sum + Math.max(0, o.total - o.amountPaid), 0);
  }, [orders]);

  const avgTicket = useMemo(() => {
    return orders.length ? totalCalculatedSpend / orders.length : 0;
  }, [orders.length, totalCalculatedSpend]);

  function handleStartOrder() {
    if (!customer) return;
    setDraftCustomer({
      name: customer.name,
      phone: customer.phone,
      id: customer.id,
    });
    router.push("/pos/add-order");
  }

  function handleCall() {
    if (!customer?.phone) {
      Alert.alert("No Phone Number", "This client profile does not have a phone number.");
      return;
    }
    void Linking.openURL(`tel:${customer.phone}`);
  }

  function handleMessage() {
    if (!customer?.phone) {
      Alert.alert("No Phone Number", "This client profile does not have a phone number.");
      return;
    }
    void Linking.openURL(`sms:${customer.phone}`);
  }

  return (
    <AppScrollScreen
      showBack
      title={customer?.name ?? "Customer Profile"}
      subtitle="Client order history, transaction records, and account balances."
      right={
        <Pressable
          style={({ pressed }) => [styles.headerSaleBtn, pressed && { opacity: 0.8 }]}
          onPress={handleStartOrder}
        >
          <Ionicons name="cart" size={16} color={Colors.white} />
          <Text style={styles.headerSaleText}>New Sale</Text>
        </Pressable>
      }
    >
      {/* Customer Header Summary Card */}
      <SectionCard>
        <View style={styles.profileHeaderRow}>
          <View style={styles.avatarWrap}>
            <Text style={styles.avatarInitials}>
              {customer?.name ? customer.name.slice(0, 2).toUpperCase() : "CU"}
            </Text>
          </View>
          <View style={styles.profileDetails}>
            <Text style={styles.profileName}>{customer?.name ?? "Loading..."}</Text>
            {customer?.phone ? (
              <Pressable style={styles.contactRow} onPress={handleCall}>
                <Ionicons name="call-outline" size={14} color={Colors.primaryBlue} />
                <Text style={styles.contactText}>{customer.phone}</Text>
              </Pressable>
            ) : null}
            {customer?.email ? (
              <View style={styles.contactRow}>
                <Ionicons name="mail-outline" size={14} color={Colors.textMuted} />
                <Text style={styles.contactTextMuted}>{customer.email}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Quick Contact Action Buttons */}
        <View style={styles.actionButtonsRow}>
          <Pressable
            style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.8 }]}
            onPress={handleCall}
          >
            <Ionicons name="call" size={16} color={Colors.primaryBlue} />
            <Text style={styles.actionButtonText}>Call</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.8 }]}
            onPress={handleMessage}
          >
            <Ionicons name="chatbubble-ellipses" size={16} color={Colors.success} />
            <Text style={[styles.actionButtonText, { color: Colors.success }]}>SMS</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              { backgroundColor: Colors.primaryBlue },
              pressed && { opacity: 0.85 },
            ]}
            onPress={handleStartOrder}
          >
            <Ionicons name="cart" size={16} color={Colors.white} />
            <Text style={[styles.actionButtonText, { color: Colors.white }]}>Create Sale</Text>
          </Pressable>
        </View>

        {customer?.notes ? (
          <View style={styles.notesBox}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.textMuted} />
            <Text style={styles.notesText}>{customer.notes}</Text>
          </View>
        ) : null}
      </SectionCard>

      {/* Financial KPIs */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>Lifetime Value</Text>
          <Text style={styles.kpiValue}>
            {sym} {totalCalculatedSpend.toFixed(2)}
          </Text>
          <Text style={styles.kpiSub}>Total order spend</Text>
        </View>

        <View
          style={[
            styles.kpiCard,
            totalUnpaidBalance > 0
              ? { backgroundColor: "#fff1f2", borderColor: "#fecdd3" }
              : { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" },
          ]}
        >
          <Text
            style={[
              styles.kpiLabel,
              { color: totalUnpaidBalance > 0 ? Colors.danger : "#16a34a" },
            ]}
          >
            Unpaid Balance
          </Text>
          <Text
            style={[
              styles.kpiValue,
              { color: totalUnpaidBalance > 0 ? "#b91c1c" : "#15803d" },
            ]}
          >
            {sym} {totalUnpaidBalance.toFixed(2)}
          </Text>
          <Text style={styles.kpiSub}>
            {totalUnpaidBalance > 0 ? "Outstanding credit" : "Account settled"}
          </Text>
        </View>
      </View>

      <View style={styles.kpiRow}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>Total Orders</Text>
          <Text style={styles.kpiValue}>{orders.length}</Text>
          <Text style={styles.kpiSub}>Completed transactions</Text>
        </View>

        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>Avg. Order Size</Text>
          <Text style={styles.kpiValue}>
            {sym} {avgTicket.toFixed(2)}
          </Text>
          <Text style={styles.kpiSub}>Average ticket value</Text>
        </View>
      </View>

      {/* Order & Transaction History */}
      <SectionCard>
        <View style={styles.historyHeader}>
          <Ionicons name="receipt-outline" size={18} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Transaction & Order History</Text>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={Colors.primaryBlue} />
            <Text style={styles.loadingText}>Loading client order history...</Text>
          </View>
        ) : orders.length > 0 ? (
          <View style={styles.ordersList}>
            {orders.map((o) => {
              const dateStr =
                typeof o.createdAt === "number"
                  ? new Date(o.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : new Date(o.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    });

              const isPartPaid = o.amountPaid < o.total;

              return (
                <Pressable
                  key={o.id}
                  style={({ pressed }) => [
                    styles.orderRow,
                    pressed && styles.orderRowPressed,
                  ]}
                  onPress={() => router.push(`/pos/receipt/${o.id}`)}
                >
                  <View style={styles.orderIconWrap}>
                    <Ionicons
                      name={isPartPaid ? "time-outline" : "checkmark-circle"}
                      size={22}
                      color={isPartPaid ? Colors.accentOrange : Colors.success}
                    />
                  </View>

                  <View style={styles.orderMeta}>
                    <Text style={styles.orderNumber}>#{o.orderNumber}</Text>
                    <Text style={styles.orderDate}>{dateStr} · {o.paymentMethod.toUpperCase()}</Text>
                  </View>

                  <View style={styles.orderAmountWrap}>
                    <Text style={styles.orderTotal}>
                      {sym} {o.total.toFixed(2)}
                    </Text>
                    {isPartPaid ? (
                      <View style={styles.badgePartPaid}>
                        <Text style={styles.badgePartPaidText}>
                          Due: {sym} {(o.total - o.amountPaid).toFixed(2)}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.orderPaidText}>Paid in full</Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyBox}>
            <Ionicons name="cart-outline" size={32} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No Orders Yet</Text>
            <Text style={styles.emptySubtitle}>
              Tap 'Create Sale' to register this customer's first order.
            </Text>
          </View>
        )}
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  headerSaleBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primaryBlue,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    gap: 4,
  },
  headerSaleText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: "700",
  },
  profileHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  avatarWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#bfdbfe",
  },
  avatarInitials: {
    fontSize: 22,
    fontWeight: "900",
    color: Colors.primaryBlue,
  },
  profileDetails: {
    flex: 1,
    gap: 3,
  },
  profileName: {
    fontSize: 18,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  contactText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.primaryBlue,
  },
  contactTextMuted: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  actionButtonsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  notesBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: Colors.background,
    padding: Spacing.sm,
    borderRadius: Radius.card,
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: "#f1f5f9",
  },
  notesText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  kpiRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textSecondary,
    textTransform: "uppercase",
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: "900",
    color: Colors.textPrimary,
    marginTop: 4,
  },
  kpiSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.title,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  loadingBox: {
    alignItems: "center",
    paddingVertical: Spacing.lg,
    gap: Spacing.xs,
  },
  loadingText: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  ordersList: {
    gap: Spacing.xs,
  },
  orderRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    padding: Spacing.md,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    gap: Spacing.sm,
  },
  orderRowPressed: {
    opacity: 0.8,
  },
  orderIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  orderMeta: {
    flex: 1,
    gap: 2,
  },
  orderNumber: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  orderDate: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  orderAmountWrap: {
    alignItems: "flex-end",
    gap: 2,
  },
  orderTotal: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  badgePartPaid: {
    backgroundColor: "#fff7ed",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#ffedd5",
  },
  badgePartPaidText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#ea580c",
  },
  orderPaidText: {
    fontSize: 11,
    color: "#16a34a",
    fontWeight: "600",
  },
  emptyBox: {
    alignItems: "center",
    paddingVertical: Spacing.lg,
    gap: 4,
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
  },
});
