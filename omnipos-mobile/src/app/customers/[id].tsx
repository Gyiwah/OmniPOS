import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Elevation } from "@/src/constants/elevation";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import {
  getCustomerWithHistory,
  settleCustomerBalance,
  updateCustomerProfile,
  type CustomerOrderSummary,
  type CustomerProfileData,
} from "@/src/features/customers/customerService";
import { useOrderDraftStore } from "@/src/store/orderDraftStore";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";

type HistoryFilterType = "all" | "unpaid" | "paid";

const PAYMENT_METHODS = [
  { key: "cash", label: "Cash", icon: "cash-outline" as const },
  { key: "card", label: "Card", icon: "card-outline" as const },
  { key: "transfer", label: "Bank Transfer", icon: "swap-horizontal-outline" as const },
  { key: "momo", label: "Mobile Money", icon: "phone-portrait-outline" as const },
];

export default function CustomerProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const currency = useSettingsStore((s) => s.currency);
  const setDraftCustomer = useOrderDraftStore((s) => s.setCustomer);

  const [customer, setCustomer] = useState<CustomerProfileData | null>(null);
  const [orders, setOrders] = useState<CustomerOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterType>("all");

  // Edit Customer Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Settle Unpaid Balance Modal State
  const [settleModalVisible, setSettleModalVisible] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [settlePaymentMethod, setSettlePaymentMethod] = useState("cash");
  const [paymentDropdownOpen, setPaymentDropdownOpen] = useState(false);
  const [settleNotes, setSettleNotes] = useState("");
  const [customPayAmount, setCustomPayAmount] = useState("");
  const [useCustomAmount, setUseCustomAmount] = useState(false);
  const [processingSettlement, setProcessingSettlement] = useState(false);

  const sym = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";

  const loadProfile = useCallback(async () => {
    if (!activeStoreId || !id) return;
    setLoading(true);
    try {
      const res = await getCustomerWithHistory(activeStoreId, id);
      setCustomer(res.customer);
      setOrders(res.orders);
    } catch (err) {
      if (__DEV__) console.warn("[OmniPOS] Error loading customer profile:", err);
    } finally {
      setLoading(false);
    }
  }, [activeStoreId, id]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  // Unpaid Orders
  const unpaidOrders = useMemo(() => {
    return orders.filter((o) => o.unpaidBalance > 0.01);
  }, [orders]);

  const totalCalculatedSpend = useMemo(() => {
    if (orders.length > 0) {
      return orders.reduce((sum, o) => sum + o.amountPaid, 0);
    }
    return customer?.totalSpend ?? 0;
  }, [customer?.totalSpend, orders]);

  const totalUnpaidBalance = useMemo(() => {
    if (unpaidOrders.length > 0) {
      return unpaidOrders.reduce((sum, o) => sum + o.unpaidBalance, 0);
    }
    return customer?.outstandingBalance ?? 0;
  }, [customer?.outstandingBalance, unpaidOrders]);

  const avgTicket = useMemo(() => {
    return orders.length ? orders.reduce((sum, o) => sum + o.total, 0) / orders.length : 0;
  }, [orders]);

  // Filtered orders list for purchase history
  const filteredOrders = useMemo(() => {
    if (historyFilter === "unpaid") {
      return orders.filter((o) => o.unpaidBalance > 0.01);
    }
    if (historyFilter === "paid") {
      return orders.filter((o) => o.unpaidBalance <= 0.01);
    }
    return orders;
  }, [historyFilter, orders]);

  // Handle Opening Edit Modal
  function handleOpenEdit() {
    if (!customer) return;
    setEditName(customer.name);
    setEditPhone(customer.phone || "");
    setEditEmail(customer.email || "");
    setEditNotes(customer.notes || "");
    setEditModalVisible(true);
  }

  // Handle Saving Edit
  async function handleSaveEdit() {
    if (!activeStoreId || !customer) return;
    if (!editName.trim()) {
      Alert.alert("Name Required", "Customer name cannot be blank.");
      return;
    }

    setSavingEdit(true);
    try {
      await updateCustomerProfile(activeStoreId, customer.id, {
        name: editName.trim(),
        phone: editPhone.trim() || undefined,
        email: editEmail.trim() || undefined,
        notes: editNotes.trim() || undefined,
      });

      setCustomer((prev) =>
        prev
          ? {
              ...prev,
              name: editName.trim(),
              phone: editPhone.trim() || undefined,
              email: editEmail.trim() || undefined,
              notes: editNotes.trim() || undefined,
            }
          : null
      );

      setEditModalVisible(false);
      Alert.alert("Profile Updated", "Customer details have been saved successfully.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update profile";
      Alert.alert("Update Error", msg);
    } finally {
      setSavingEdit(false);
    }
  }

  // Handle Opening Settlement Modal
  function handleOpenSettlement() {
    if (!customer) return;
    setSelectedOrderIds(unpaidOrders.map((o) => o.id));
    setUseCustomAmount(false);
    setCustomPayAmount("");
    setSettlePaymentMethod("cash");
    setPaymentDropdownOpen(false);
    setSettleNotes("");
    setSettleModalVisible(true);
  }

  // Calculate settlement total
  const selectedUnpaidTotal = useMemo(() => {
    return unpaidOrders
      .filter((o) => selectedOrderIds.includes(o.id))
      .reduce((sum, o) => sum + o.unpaidBalance, 0);
  }, [selectedOrderIds, unpaidOrders]);

  const effectiveSettlementAmount = useMemo(() => {
    if (useCustomAmount) {
      const val = parseFloat(customPayAmount);
      return isNaN(val) ? 0 : Math.max(0, val);
    }
    return selectedUnpaidTotal;
  }, [customPayAmount, selectedUnpaidTotal, useCustomAmount]);

  // Toggle order selection for settlement
  function toggleOrderSelection(orderId: string) {
    setSelectedOrderIds((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]
    );
  }

  // Select all or deselect all
  function toggleSelectAllOrders() {
    if (selectedOrderIds.length === unpaidOrders.length) {
      setSelectedOrderIds([]);
    } else {
      setSelectedOrderIds(unpaidOrders.map((o) => o.id));
    }
  }

  // Execute Balance Settlement
  async function handleConfirmSettlement() {
    if (!activeStoreId || !customer) return;
    if (effectiveSettlementAmount <= 0) {
      Alert.alert("Invalid Amount", "Please enter or select an amount greater than 0.");
      return;
    }

    setProcessingSettlement(true);
    try {
      let remainingToAllocate = effectiveSettlementAmount;
      const payments = [];

      const targetOrders = unpaidOrders.filter((o) =>
        selectedOrderIds.length > 0 ? selectedOrderIds.includes(o.id) : true
      );

      for (const ord of targetOrders) {
        if (remainingToAllocate <= 0) break;
        const payForThis = Math.min(ord.unpaidBalance, remainingToAllocate);
        payments.push({
          orderId: ord.id,
          paymentAmount: payForThis,
        });
        remainingToAllocate -= payForThis;
      }

      if (remainingToAllocate > 0 && payments.length > 0) {
        payments[0].paymentAmount += remainingToAllocate;
      }

      await settleCustomerBalance({
        storeId: activeStoreId,
        customerId: customer.id,
        paymentMethod: settlePaymentMethod,
        notes: settleNotes.trim() || undefined,
        payments,
      });

      setSettleModalVisible(false);
      Alert.alert(
        "Settlement Complete",
        `Successfully recorded payment of ${sym} ${effectiveSettlementAmount.toFixed(2)} via ${settlePaymentMethod.toUpperCase()}.`
      );
      void loadProfile();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to process settlement";
      Alert.alert("Settlement Error", msg);
    } finally {
      setProcessingSettlement(false);
    }
  }

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

  const currentSelectedPaymentMethod =
    PAYMENT_METHODS.find((pm) => pm.key === settlePaymentMethod) ?? PAYMENT_METHODS[0];

  return (
    <AppScrollScreen
      showBack
      title={customer?.name ?? "Customer Profile"}
      subtitle="Client details, purchase history & balance settlement"
      right={
        <View style={styles.headerActionsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create New Sale"
            style={({ pressed }) => [styles.headerSaleBtn, pressed && styles.iconBtnPressed]}
            onPress={handleStartOrder}
          >
            <Ionicons name="cart" size={16} color={Colors.white} />
            <Text style={styles.headerSaleText}>New Sale</Text>
          </Pressable>
        </View>
      }
    >
      {/* Outstanding Balance Attention Banner */}
      {totalUnpaidBalance > 0 ? (
        <View style={styles.debtBanner}>
          <View style={styles.debtBannerLeft}>
            <View style={styles.debtIconWrap}>
              <Ionicons name="alert-circle" size={22} color="#dc2626" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.debtBannerTitle}>Unpaid Credit Balance</Text>
              <Text style={styles.debtBannerSubtitle}>
                {sym} {totalUnpaidBalance.toFixed(2)} outstanding across {unpaidOrders.length} order(s)
              </Text>
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [styles.debtSettleBtn, pressed && { opacity: 0.85 }]}
            onPress={handleOpenSettlement}
          >
            <Ionicons name="checkmark-circle" size={15} color={Colors.white} />
            <Text style={styles.debtSettleBtnText}>Settle Debt</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Customer Header Summary Card */}
      <SectionCard>
        <View style={styles.profileHeaderRow}>
          <View style={styles.avatarWrap}>
            <Text style={styles.avatarInitials}>
              {customer?.name ? customer.name.slice(0, 2).toUpperCase() : "CU"}
            </Text>
          </View>
          <View style={styles.profileDetails}>
            <View style={styles.nameRow}>
              <Text style={styles.profileName}>{customer?.name ?? "Loading..."}</Text>
              <Pressable onPress={handleOpenEdit} hitSlop={8} style={styles.inlineEditBtn}>
                <Ionicons name="pencil" size={14} color={Colors.primaryBlue} />
                <Text style={styles.inlineEditText}>Edit</Text>
              </Pressable>
            </View>
            {customer?.phone ? (
              <Pressable style={styles.contactRow} onPress={handleCall}>
                <Ionicons name="call-outline" size={13} color={Colors.primaryBlue} />
                <Text style={styles.contactText}>{customer.phone}</Text>
              </Pressable>
            ) : (
              <Text style={styles.missingContactText}>No phone recorded</Text>
            )}
            {customer?.email ? (
              <View style={styles.contactRow}>
                <Ionicons name="mail-outline" size={13} color={Colors.textMuted} />
                <Text style={styles.contactTextMuted}>{customer.email}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Quick Contact & Action Buttons */}
        <View style={styles.actionButtonsRow}>
          <Pressable
            style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
            onPress={handleCall}
          >
            <Ionicons name="call" size={15} color={Colors.primaryBlue} />
            <Text style={styles.actionButtonText}>Call</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
            onPress={handleMessage}
          >
            <Ionicons name="chatbubble-ellipses" size={15} color={Colors.success} />
            <Text style={[styles.actionButtonText, { color: Colors.success }]}>SMS</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
            onPress={handleOpenEdit}
          >
            <Ionicons name="create-outline" size={15} color={Colors.textPrimary} />
            <Text style={[styles.actionButtonText, { color: Colors.textPrimary }]}>Edit Info</Text>
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
          <Text style={styles.kpiSub}>Total paid purchases</Text>
        </View>

        <Pressable
          style={[
            styles.kpiCard,
            totalUnpaidBalance > 0
              ? { backgroundColor: "#fff1f2", borderColor: "#fecdd3" }
              : { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" },
          ]}
          onPress={() => {
            if (totalUnpaidBalance > 0) handleOpenSettlement();
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text
              style={[
                styles.kpiLabel,
                { color: totalUnpaidBalance > 0 ? Colors.danger : "#16a34a" },
              ]}
            >
              Unpaid Balance
            </Text>
            {totalUnpaidBalance > 0 ? (
              <Ionicons name="chevron-forward" size={14} color={Colors.danger} />
            ) : null}
          </View>
          <Text
            style={[
              styles.kpiValue,
              { color: totalUnpaidBalance > 0 ? "#b91c1c" : "#15803d" },
            ]}
          >
            {sym} {totalUnpaidBalance.toFixed(2)}
          </Text>
          <Text style={styles.kpiSub}>
            {totalUnpaidBalance > 0 ? "Tap to settle balance" : "Account settled in full"}
          </Text>
        </Pressable>
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

      {/* Customer Purchase History */}
      <SectionCard>
        <View style={styles.historyHeader}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="receipt-outline" size={18} color={Colors.primaryBlue} />
            <Text style={styles.sectionTitle}>Purchase History</Text>
          </View>

          {/* Filter Tabs: All / Unpaid / Paid */}
          <View style={styles.historyFilterTabs}>
            <Pressable
              style={[
                styles.historyFilterTab,
                historyFilter === "all" && styles.historyFilterTabActive,
              ]}
              onPress={() => setHistoryFilter("all")}
            >
              <Text
                style={[
                  styles.historyFilterTabText,
                  historyFilter === "all" && styles.historyFilterTabTextActive,
                ]}
              >
                All ({orders.length})
              </Text>
            </Pressable>

            {unpaidOrders.length > 0 ? (
              <Pressable
                style={[
                  styles.historyFilterTab,
                  historyFilter === "unpaid" && styles.historyFilterTabUnpaidActive,
                ]}
                onPress={() => setHistoryFilter("unpaid")}
              >
                <Text
                  style={[
                    styles.historyFilterTabText,
                    historyFilter === "unpaid" && styles.historyFilterTabTextActive,
                    historyFilter !== "unpaid" && { color: "#dc2626" },
                  ]}
                >
                  Unpaid ({unpaidOrders.length})
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              style={[
                styles.historyFilterTab,
                historyFilter === "paid" && styles.historyFilterTabActive,
              ]}
              onPress={() => setHistoryFilter("paid")}
            >
              <Text
                style={[
                  styles.historyFilterTabText,
                  historyFilter === "paid" && styles.historyFilterTabTextActive,
                ]}
              >
                Paid
              </Text>
            </Pressable>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={Colors.primaryBlue} />
            <Text style={styles.loadingText}>Loading client purchase records...</Text>
          </View>
        ) : filteredOrders.length > 0 ? (
          <View style={styles.ordersList}>
            {filteredOrders.map((o) => {
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

              const isPartPaid = o.unpaidBalance > 0.01;

              return (
                <Pressable
                  key={o.id}
                  style={({ pressed }) => [
                    styles.orderRow,
                    pressed && styles.orderRowPressed,
                    isPartPaid && styles.orderRowUnpaid,
                  ]}
                  onPress={() => router.push(`/pos/receipt/${o.id}`)}
                >
                  <View
                    style={[
                      styles.orderIconWrap,
                      isPartPaid
                        ? { backgroundColor: "#fee2e2" }
                        : { backgroundColor: "#f0fdf4" },
                    ]}
                  >
                    <Ionicons
                      name={isPartPaid ? "time-outline" : "checkmark-circle"}
                      size={20}
                      color={isPartPaid ? "#dc2626" : Colors.success}
                    />
                  </View>

                  <View style={styles.orderMeta}>
                    <Text style={styles.orderNumber}>#{o.orderNumber}</Text>
                    <Text style={styles.orderDate}>
                      {dateStr} · {o.paymentMethod.toUpperCase()}
                    </Text>
                  </View>

                  <View style={styles.orderAmountWrap}>
                    <Text style={styles.orderTotal}>
                      {sym} {o.total.toFixed(2)}
                    </Text>
                    {isPartPaid ? (
                      <View style={styles.badgePartPaid}>
                        <Text style={styles.badgePartPaidText}>
                          Due: {sym} {o.unpaidBalance.toFixed(2)}
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
            <Text style={styles.emptyTitle}>No Orders Found</Text>
            <Text style={styles.emptySubtitle}>
              {historyFilter === "unpaid"
                ? "This customer has no unpaid orders."
                : "Tap 'New Sale' to register this customer's first order."}
            </Text>
          </View>
        )}
      </SectionCard>

      {/* EDIT CUSTOMER MODAL */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="person-circle-outline" size={24} color={Colors.primaryBlue} />
                <Text style={styles.modalTitle}>Edit Customer Profile</Text>
              </View>
              <Pressable
                onPress={() => setEditModalVisible(false)}
                hitSlop={10}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={20} color={Colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.modalScroll}>
              <TextInput
                label="Full Name *"
                value={editName}
                onChangeText={setEditName}
                placeholder="Client full name"
                leftIcon={<Ionicons name="person-outline" size={18} color={Colors.textMuted} />}
              />

              <TextInput
                label="Phone Number"
                value={editPhone}
                onChangeText={setEditPhone}
                placeholder="Phone number"
                keyboardType="phone-pad"
                leftIcon={<Ionicons name="call-outline" size={18} color={Colors.textMuted} />}
              />

              <TextInput
                label="Email Address"
                value={editEmail}
                onChangeText={setEditEmail}
                placeholder="Email address"
                autoCapitalize="none"
                keyboardType="email-address"
                leftIcon={<Ionicons name="mail-outline" size={18} color={Colors.textMuted} />}
              />

              <TextInput
                label="Customer Notes & Instructions"
                value={editNotes}
                onChangeText={setEditNotes}
                placeholder="e.g. Preferred delivery schedule or preferences..."
                multiline
                numberOfLines={3}
                leftIcon={<Ionicons name="document-text-outline" size={18} color={Colors.textMuted} />}
              />

              <View style={styles.modalActionsRow}>
                <Pressable
                  style={[styles.modalCancelBtn]}
                  onPress={() => setEditModalVisible(false)}
                  disabled={savingEdit}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalSaveBtn, savingEdit && { opacity: 0.6 }]}
                  onPress={() => void handleSaveEdit()}
                  disabled={savingEdit}
                >
                  {savingEdit ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <Ionicons name="checkmark-circle-outline" size={18} color={Colors.white} />
                  )}
                  <Text style={styles.modalSaveText}>
                    {savingEdit ? "Saving..." : "Save Changes"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* SETTLE UNPAID BALANCE MODAL - PROFESSIONALLY ARRANGED WITH DROPDOWN PAYMENT METHOD */}
      <Modal
        visible={settleModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSettleModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalContainer, { maxHeight: "90%" }]}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={styles.modalHeaderIconWrap}>
                  <Ionicons name="wallet" size={20} color={Colors.primaryBlue} />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Settle Unpaid Debt</Text>
                  <Text style={styles.modalSubtitle}>
                    {customer?.name} · Due: {sym} {totalUnpaidBalance.toFixed(2)}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => setSettleModalVisible(false)}
                hitSlop={10}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={20} color={Colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.modalScroll}>
              {/* 1. Unpaid Orders Selection Section */}
              <View style={styles.settleSection}>
                <View style={styles.settleSectionHeader}>
                  <Text style={styles.settleSectionTitle}>Select Unpaid Orders</Text>
                  <Pressable onPress={toggleSelectAllOrders} hitSlop={8}>
                    <Text style={styles.selectAllText}>
                      {selectedOrderIds.length === unpaidOrders.length ? "Deselect All" : "Select All"}
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.unpaidOrdersList}>
                  {unpaidOrders.map((ord) => {
                    const isSelected = selectedOrderIds.includes(ord.id);
                    return (
                      <Pressable
                        key={ord.id}
                        style={[
                          styles.unpaidOrderCard,
                          isSelected && styles.unpaidOrderCardSelected,
                        ]}
                        onPress={() => toggleOrderSelection(ord.id)}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            isSelected && styles.checkboxSelected,
                          ]}
                        >
                          {isSelected ? (
                            <Ionicons name="checkmark" size={14} color={Colors.white} />
                          ) : null}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.unpaidOrderNum}>#{ord.orderNumber}</Text>
                          <Text style={styles.unpaidOrderMeta}>
                            Total: {sym} {ord.total.toFixed(2)} · Paid: {sym} {ord.amountPaid.toFixed(2)}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={styles.unpaidDueLabel}>Amount Due</Text>
                          <Text style={styles.unpaidDueValue}>
                            {sym} {ord.unpaidBalance.toFixed(2)}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* 2. Amount Option Selection */}
              <View style={styles.settleSection}>
                <Text style={styles.settleSectionTitle}>Payment Option</Text>
                <View style={styles.amountModeRow}>
                  <Pressable
                    style={[
                      styles.amountModeBtn,
                      !useCustomAmount && styles.amountModeBtnActive,
                    ]}
                    onPress={() => setUseCustomAmount(false)}
                  >
                    <Text
                      style={[
                        styles.amountModeBtnText,
                        !useCustomAmount && styles.amountModeBtnTextActive,
                      ]}
                    >
                      Selected Orders ({sym} {selectedUnpaidTotal.toFixed(2)})
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.amountModeBtn,
                      useCustomAmount && styles.amountModeBtnActive,
                    ]}
                    onPress={() => setUseCustomAmount(true)}
                  >
                    <Text
                      style={[
                        styles.amountModeBtnText,
                        useCustomAmount && styles.amountModeBtnTextActive,
                      ]}
                    >
                      Custom Amount
                    </Text>
                  </Pressable>
                </View>

                {useCustomAmount ? (
                  <View style={{ marginTop: Spacing.sm }}>
                    <TextInput
                      label="Custom Payment Amount"
                      value={customPayAmount}
                      onChangeText={setCustomPayAmount}
                      placeholder={`0.00 (Max: ${totalUnpaidBalance.toFixed(2)})`}
                      keyboardType="numeric"
                      leftIcon={<Text style={{ fontWeight: "700", color: Colors.primaryBlue }}>{sym}</Text>}
                    />
                  </View>
                ) : null}
              </View>

              {/* 3. Payment Method Dropdown (Dropdown List) */}
              <View style={styles.settleSection}>
                <Text style={styles.settleSectionTitle}>Payment Method</Text>
                <Pressable
                  style={[
                    styles.dropdownTrigger,
                    paymentDropdownOpen && styles.dropdownTriggerActive,
                  ]}
                  onPress={() => setPaymentDropdownOpen((v) => !v)}
                >
                  <View style={styles.dropdownLeft}>
                    <Ionicons
                      name={currentSelectedPaymentMethod.icon}
                      size={18}
                      color={Colors.primaryBlue}
                    />
                    <Text style={styles.dropdownTriggerText}>
                      {currentSelectedPaymentMethod.label}
                    </Text>
                  </View>
                  <Ionicons
                    name={paymentDropdownOpen ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={Colors.textMuted}
                  />
                </Pressable>

                {paymentDropdownOpen ? (
                  <View style={styles.dropdownMenu}>
                    {PAYMENT_METHODS.map((pm) => {
                      const isSelected = settlePaymentMethod === pm.key;
                      return (
                        <Pressable
                          key={pm.key}
                          style={[
                            styles.dropdownItem,
                            isSelected && styles.dropdownItemActive,
                          ]}
                          onPress={() => {
                            setSettlePaymentMethod(pm.key);
                            setPaymentDropdownOpen(false);
                          }}
                        >
                          <View style={styles.dropdownItemLeft}>
                            <Ionicons
                              name={pm.icon}
                              size={18}
                              color={isSelected ? Colors.primaryBlue : Colors.textSecondary}
                            />
                            <Text
                              style={[
                                styles.dropdownItemText,
                                isSelected && styles.dropdownItemTextActive,
                              ]}
                            >
                              {pm.label}
                            </Text>
                          </View>
                          {isSelected ? (
                            <Ionicons name="checkmark" size={18} color={Colors.primaryBlue} />
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>

              {/* 4. Optional Transaction Note */}
              <View style={styles.settleSection}>
                <TextInput
                  label="Transaction Reference / Note (Optional)"
                  value={settleNotes}
                  onChangeText={setSettleNotes}
                  placeholder="e.g. Mobile money transaction ID or deposit note..."
                  leftIcon={<Ionicons name="document-text-outline" size={16} color={Colors.textMuted} />}
                />
              </View>

              {/* 5. Executive Settlement Summary */}
              <View style={styles.settleSummaryBox}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Total Payment to Collect:</Text>
                  <Text style={styles.summaryAmount}>
                    {sym} {effectiveSettlementAmount.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summarySubLabel}>Remaining Customer Debt:</Text>
                  <Text
                    style={[
                      styles.summarySubValue,
                      totalUnpaidBalance - effectiveSettlementAmount <= 0.01 && {
                        color: Colors.success,
                      },
                    ]}
                  >
                    {totalUnpaidBalance - effectiveSettlementAmount <= 0.01
                      ? "Cleared ($0.00)"
                      : `${sym} ${(totalUnpaidBalance - effectiveSettlementAmount).toFixed(2)}`}
                  </Text>
                </View>
              </View>

              {/* 6. Modal Bottom Actions */}
              <View style={styles.modalActionsRow}>
                <Pressable
                  style={styles.modalCancelBtn}
                  onPress={() => setSettleModalVisible(false)}
                  disabled={processingSettlement}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.modalSaveBtn,
                    (effectiveSettlementAmount <= 0 || processingSettlement) && { opacity: 0.6 },
                  ]}
                  onPress={() => void handleConfirmSettlement()}
                  disabled={effectiveSettlementAmount <= 0 || processingSettlement}
                >
                  {processingSettlement ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <Ionicons name="checkmark-done-circle" size={18} color={Colors.white} />
                  )}
                  <Text style={styles.modalSaveText}>
                    {processingSettlement ? "Processing..." : "Complete Payment"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  headerActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerSaleBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primaryBlue,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    gap: 4,
  },
  headerSaleText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: "700",
  },
  iconBtnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.96 }],
  },
  debtBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fef2f2",
    borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: "#fecaca",
    gap: Spacing.sm,
  },
  debtBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  debtIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
  },
  debtBannerTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#b91c1c",
  },
  debtBannerSubtitle: {
    fontSize: 12,
    color: "#dc2626",
    marginTop: 1,
  },
  debtSettleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#dc2626",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
  },
  debtSettleBtnText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: "800",
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
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  profileName: {
    fontSize: 18,
    fontWeight: "800",
    color: Colors.textPrimary,
    flex: 1,
  },
  inlineEditBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: Colors.primaryBluePale,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  inlineEditText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primaryBlue,
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
  missingContactText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontStyle: "italic",
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
    paddingVertical: 9,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  actionButtonPressed: {
    opacity: 0.8,
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
    ...Elevation.card,
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
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  sectionTitle: {
    ...Typography.title,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  historyFilterTabs: {
    flexDirection: "row",
    gap: 4,
  },
  historyFilterTab: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  historyFilterTabActive: {
    backgroundColor: Colors.primaryBlue,
    borderColor: Colors.primaryBlue,
  },
  historyFilterTabUnpaidActive: {
    backgroundColor: "#dc2626",
    borderColor: "#dc2626",
  },
  historyFilterTabText: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  historyFilterTabTextActive: {
    color: Colors.white,
    fontWeight: "700",
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
  orderRowUnpaid: {
    borderColor: "#fed7aa",
    backgroundColor: "#fffdfa",
  },
  orderIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.md,
    gap: Spacing.sm,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  modalHeaderIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    color: "#dc2626",
    fontWeight: "600",
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalScroll: {
    marginVertical: Spacing.xs,
  },
  modalActionsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  modalSaveBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryBlue,
  },
  modalSaveText: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.white,
  },
  settleSection: {
    marginTop: Spacing.sm,
    gap: 6,
  },
  settleSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  settleSectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  selectAllText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  unpaidOrdersList: {
    gap: 6,
    marginTop: 4,
  },
  unpaidOrderCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.sm + 2,
    borderRadius: Radius.card,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  unpaidOrderCardSelected: {
    borderColor: Colors.primaryBlue,
    backgroundColor: Colors.primaryBluePale,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
  },
  checkboxSelected: {
    backgroundColor: Colors.primaryBlue,
    borderColor: Colors.primaryBlue,
  },
  unpaidOrderNum: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  unpaidOrderMeta: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  unpaidDueLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: Colors.textMuted,
    textTransform: "uppercase",
  },
  unpaidDueValue: {
    fontSize: 13,
    fontWeight: "800",
    color: "#dc2626",
  },
  amountModeRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    marginTop: 2,
  },
  amountModeBtn: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  amountModeBtnActive: {
    backgroundColor: Colors.primaryBlue,
    borderColor: Colors.primaryBlue,
  },
  amountModeBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textSecondary,
    textAlign: "center",
  },
  amountModeBtnTextActive: {
    color: Colors.white,
    fontWeight: "700",
  },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 3,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    minHeight: 48,
  },
  dropdownTriggerActive: {
    borderColor: Colors.primaryBlue,
  },
  dropdownLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  dropdownTriggerText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  dropdownMenu: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    overflow: "hidden",
    marginTop: 4,
    ...Elevation.card,
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.divider,
  },
  dropdownItemActive: {
    backgroundColor: Colors.primaryBluePale,
  },
  dropdownItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  dropdownItemText: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: "500",
  },
  dropdownItemTextActive: {
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
  settleSummaryBox: {
    backgroundColor: "#f8fafc",
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    gap: 4,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  summaryAmount: {
    fontSize: 18,
    fontWeight: "900",
    color: Colors.primaryBlue,
  },
  summarySubLabel: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  summarySubValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#dc2626",
  },
});
