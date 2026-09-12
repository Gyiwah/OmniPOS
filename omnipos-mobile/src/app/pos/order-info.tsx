import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Q } from "@nozbe/watermelondb";

import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { supabase } from "@/src/services/supabase";
import {
  decrementStockForOrder,
  fetchStockByProductId,
  InsufficientStockError,
  restoreStockForOrder,
  validateCartQuantities,
} from "@/src/features/orders/stock";
import { useAuthStore } from "@/src/store/authStore";
import { useOrderDraftStore, type PaymentMethod } from "@/src/store/orderDraftStore";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";

import { enqueueChange } from "@/src/sync/enqueue";
import { database } from "@/src/database";
import type Order from "@/src/database/models/Order";
import type OrderItem from "@/src/database/models/OrderItem";
import type Customer from "@/src/database/models/Customer";
import { usingLaravel } from "@/src/core/api/config";
import { tenderSuggestions } from "@/src/utils/cartMath";
import { uuidv7 } from "@/src/core/ids";

function symbolFor(currency: string) {
  if (currency === "USD") return "$";
  if (currency === "NGN") return "₦";
  return "₵";
}

type CustomerOption = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  outstandingBalance: number;
  totalSpend: number;
};

export default function OrderInfoScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const userId = useAuthStore((s) => s.userId);
  const {
    lines,
    discountMode,
    discountValue,
    amountPaid,
    paymentMethod,
    customerName,
    customerPhone,
    customerId,
    shippingAddress,
    setDiscountMode,
    setDiscountValue,
    setAmountPaid,
    setPaymentMethod,
    setCustomer,
    clearDraft,
  } = useOrderDraftStore();
  const { currency, taxRate, vatRate, serviceRate } = useSettingsStore();
  const [customerOpen, setCustomerOpen] = useState(false);
  const [saveToCrm, setSaveToCrm] = useState(false);
  const [existingCustomers, setExistingCustomers] = useState<CustomerOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Load existing customers for quick auto-suggest
  useEffect(() => {
    let mounted = true;
    async function loadCustomers() {
      if (!activeStoreId) return;
      try {
        const rows = await database
          .get<Customer>("customers")
          .query(Q.where("store_id", activeStoreId))
          .fetch();
        if (mounted) {
          setExistingCustomers(
            rows.map((r) => ({
              id: r.id,
              name: r.name,
              phone: r.phone,
              email: r.email,
              outstandingBalance: Number(r.outstandingBalance ?? 0),
              totalSpend: Number(r.totalSpend ?? 0),
            })),
          );
        }
      } catch {
        // ignore
      }
    }
    void loadCustomers();
    return () => {
      mounted = false;
    };
  }, [activeStoreId]);

  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + line.price * line.quantity, 0), [lines]);
  const discountAmount = useMemo(
    () => (discountMode === "percentage" ? subtotal * (discountValue / 100) : discountValue),
    [discountMode, discountValue, subtotal],
  );
  const taxedBase = Math.max(0, subtotal - discountAmount);
  const tax = taxedBase * (taxRate / 100);
  const vat = taxedBase * (vatRate / 100);
  const service = taxedBase * (serviceRate / 100);
  const total = taxedBase + tax + vat + service;

  const change = Math.max(0, amountPaid - total);
  const balance = Math.max(0, total - amountPaid);
  const sym = symbolFor(currency);

  // Sync default amountPaid with total if 0
  useEffect(() => {
    if (amountPaid === 0 && total > 0) {
      setAmountPaid(Number(total.toFixed(2)));
    }
  }, [total]);

  const matchedCustomers = useMemo(() => {
    const q = (customerName || "").trim().toLowerCase();
    const qPhone = (customerPhone || "").trim();
    if (!q && !qPhone) return [];
    return existingCustomers
      .filter((c) => {
        const nameMatch = q ? c.name.toLowerCase().includes(q) : false;
        const phoneMatch = qPhone && c.phone ? c.phone.includes(qPhone) : false;
        return nameMatch || phoneMatch;
      })
      .slice(0, 4);
  }, [customerName, customerPhone, existingCustomers]);

  function selectExistingCustomer(c: CustomerOption) {
    setCustomer({
      name: c.name,
      phone: c.phone,
      id: c.id,
    });
  }

  async function updateCustomerCrmRecord(assignedCustomerId?: string) {
    if (!activeStoreId || !customerName?.trim()) return;
    const now = Date.now();
    const paid = amountPaid;
    const unpaid = Math.max(0, total - paid);

    try {
      let targetCust: Customer | null = null;
      if (assignedCustomerId) {
        try {
          targetCust = await database.get<Customer>("customers").find(assignedCustomerId);
        } catch {
          // not found by id
        }
      }
      if (!targetCust) {
        const matches = await database
          .get<Customer>("customers")
          .query(
            Q.where("store_id", activeStoreId),
            customerPhone ? Q.where("phone", customerPhone.trim()) : Q.where("name", customerName.trim()),
          )
          .fetch();
        targetCust = matches[0] ?? null;
      }

      if (targetCust) {
        const nextSpend = Number(targetCust.totalSpend ?? 0) + paid;
        const nextBal = Number(targetCust.outstandingBalance ?? 0) + unpaid;

        await database.write(async () => {
          await targetCust!.update((rec) => {
            rec.totalSpend = nextSpend;
            rec.outstandingBalance = nextBal;
            rec.updatedAt = now;
            rec.dirty = true;
          });
        });

        const custRemoteId = targetCust.remoteId || targetCust.id;

        try {
          const net = await NetInfo.fetch();
          // Under Laravel the queued branch is the only path to the server;
          // writing directly as well would split data across two backends.
          if (!usingLaravel && net.isConnected && net.isInternetReachable !== false) {
            await supabase.from("customers").upsert(
              {
                id: custRemoteId,
                store_id: activeStoreId,
                name: targetCust.name,
                phone: targetCust.phone ?? null,
                email: targetCust.email ?? null,
                total_spend: nextSpend,
                outstanding_balance: nextBal,
              },
              { onConflict: "id" },
            );
          } else {
            await enqueueChange({
              storeId: activeStoreId,
              entity: "customers",
              operation: "upsert",
              recordId: targetCust.id,
              payload: {
                id: custRemoteId,
                store_id: activeStoreId,
                name: targetCust.name,
                phone: targetCust.phone ?? null,
                total_spend: nextSpend,
                outstanding_balance: nextBal,
              },
            });
          }
        } catch {
          // fallback queue
        }
      } else if (saveToCrm) {
        let createdCustomer: Customer;
        await database.write(async () => {
          createdCustomer = await database.get<Customer>("customers").create((rec) => {
            rec.storeId = activeStoreId;
            rec.name = customerName.trim();
            rec.phone = customerPhone?.trim() || undefined;
            rec.totalSpend = paid;
            rec.outstandingBalance = unpaid;
            rec.updatedAt = now;
            rec.dirty = true;
          });
        });

        try {
          const net = await NetInfo.fetch();
          // Under Laravel the queued branch is the only path to the server;
          // writing directly as well would split data across two backends.
          if (!usingLaravel && net.isConnected && net.isInternetReachable !== false) {
            await supabase.from("customers").insert({
              id: createdCustomer!.id,
              store_id: activeStoreId,
              name: customerName.trim(),
              phone: customerPhone?.trim() || null,
              total_spend: paid,
              outstanding_balance: unpaid,
            });
          } else {
            await enqueueChange({
              storeId: activeStoreId,
              entity: "customers",
              operation: "insert",
              recordId: createdCustomer!.id,
              payload: {
                id: createdCustomer!.id,
                store_id: activeStoreId,
                name: customerName.trim(),
                phone: customerPhone?.trim() || null,
                total_spend: paid,
                outstanding_balance: unpaid,
              },
            });
          }
        } catch {
          // offline queue
        }
      }
    } catch {
      // ignore CRM update error
    }
  }

  async function saveOrderOffline(orderNumber: string, cashierUserId: string, orderId: string) {
    if (!activeStoreId) return;
    const now = Date.now();
    let localOrderId = orderId;
    const orderStatus = amountPaid >= total - 0.01 ? "completed" : amountPaid <= 0 ? "credit" : "part_paid";

    await database.write(async () => {
      const ordersCol = database.get<Order>("orders");
      const orderItemsCol = database.get<OrderItem>("order_items");

      const createdOrder = await ordersCol.create((rec) => {
        /*
         * Minted by the caller, before stock moved, so the movements recorded
         * for this sale can name it. Client-minted UUIDv7 is the identity
         * scheme throughout: a local primary key is already the server's.
         */
        rec._raw.id = orderId;
        rec.storeId = activeStoreId;
        rec.cashierUserId = cashierUserId;
        rec.orderNumber = orderNumber;
        rec.status = orderStatus;
        rec.subtotal = subtotal;
        rec.tax = tax;
        rec.discount = discountAmount;
        rec.total = total;
        rec.amountPaid = amountPaid;
        rec.changeDue = change;
        rec.paymentMethod = paymentMethod;
        rec.customerName = customerName || undefined;
        rec.customerPhone = customerPhone || undefined;
        rec.customerId = customerId || undefined;
        rec.createdAt = now;
        rec.dirty = true;
      });
      localOrderId = createdOrder.id;

      for (const line of lines) {
        await orderItemsCol.create((rec) => {
          rec.orderId = createdOrder.id;
          rec.storeId = activeStoreId;
          rec.productId = line.remoteId || line.id;
          rec.productName = line.name;
          rec.sku = line.sku;
          rec.barcode = line.barcode;
          rec.unitPrice = line.price;
          rec.quantity = line.quantity;
          rec.lineTotal = line.price * line.quantity;
        });
      }
    });

    try {
      await enqueueChange({
        storeId: activeStoreId,
        entity: "orders",
        operation: "upsert",
        recordId: localOrderId,
        payload: {
          id: localOrderId,
          order_number: orderNumber,
          store_id: activeStoreId,
          cashier_user_id: cashierUserId,
          status: orderStatus,
          subtotal,
          tax_rate: taxRate,
          vat_rate: vatRate,
          service_rate: serviceRate,
          discount_mode: discountMode,
          discount_value: discountValue,
          total,
          amount_paid: amountPaid,
          change_due: change,
          payment_method: paymentMethod,
          customer_name: customerName || null,
          customer_phone: customerPhone || null,
          customer_id: customerId || null,
          shipping_address: shippingAddress || null,
        },
      });
    } catch {
      // offline fallback
    }

    void updateCustomerCrmRecord(customerId);

    clearDraft();
    router.push(`/pos/receipt/${localOrderId}`);
  }

  async function createReceipt() {
    if (!activeStoreId) {
      Alert.alert("Store missing", "Active store is required to create an order.");
      return;
    }
    if (lines.length === 0) {
      Alert.alert("No items", "Add items to your cart before proceeding to checkout.");
      return;
    }

    const isProfileCustomer = Boolean(customerId || (customerName?.trim() && saveToCrm));
    if (!isProfileCustomer && (amountPaid < total - 0.01 || amountPaid <= 0)) {
      Alert.alert(
        "Full Payment Required for Walk-ins",
        `Walk-in customers must make full payment (${sym} ${total.toFixed(2)}).\n\nTo allow partial payment or store credit, please assign a Customer Profile or enter a customer name and enable "Save customer to store directory".`,
      );
      return;
    }

    setSubmitting(true);
    let stockAdjusted = false;

    /*
     * Minted here, before anything moves, so the order and the stock movements
     * it causes carry the same identity — including on the rollback path
     * below, which is precisely when someone needs to trace what happened.
     */
    const orderId = uuidv7();

    try {
      const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;
      const cashierUserId = userId ?? "00000000-0000-0000-0000-000000000000";
      const orderStatus = amountPaid >= total - 0.01 ? "completed" : amountPaid <= 0 ? "credit" : "part_paid";

      const freshStock = await fetchStockByProductId(
        activeStoreId,
        lines.map((l) => l.id),
      );
      validateCartQuantities(lines, freshStock);

      await decrementStockForOrder(activeStoreId, lines, orderId);
      stockAdjusted = true;

      const net = await NetInfo.fetch();
      /*
       * Under Laravel every sale goes down the offline path — which is not a
       * fallback but the normal route: it writes locally and queues, and the
       * sync engine delivers it idempotently. Inserting straight into Supabase
       * would put the sale in the wrong database entirely.
       */
      const isOnline = !usingLaravel && Boolean(net.isConnected && net.isInternetReachable !== false);

      if (!isOnline) {
        await saveOrderOffline(orderNumber, cashierUserId, orderId);
      } else {
        try {
          const { data: inserted, error: orderError } = await supabase
            .from("orders")
            .insert({
              // The same id the stock movements were recorded against. Letting
              // the server pick its own would leave those movements naming a
              // sale that does not exist, which is worse than naming none.
              id: orderId,
              store_id: activeStoreId,
              cashier_user_id: cashierUserId,
              order_number: orderNumber,
              status: orderStatus,
              subtotal,
              tax_rate: taxRate,
              vat_rate: vatRate,
              service_rate: serviceRate,
              discount_mode: discountMode,
              discount_value: discountValue,
              total,
              amount_paid: amountPaid,
              change_due: change,
              payment_method: paymentMethod,
              customer_name: customerName || null,
              customer_phone: customerPhone || null,
              customer_id: customerId || null,
              shipping_address: shippingAddress || null,
            })
            .select("id")
            .single();

          if (orderError || !inserted) {
            throw orderError ?? new Error("Cloud order creation failed.");
          }

          const itemsPayload = lines.map((line) => ({
            order_id: inserted.id,
            store_id: activeStoreId,
            product_id: line.remoteId || line.id,
            product_name: line.name,
            sku: line.sku,
            barcode: line.barcode,
            unit_price: line.price,
            quantity: line.quantity,
            line_total: line.price * line.quantity,
          }));

          const { error: itemsError } = await supabase.from("order_items").insert(itemsPayload);
          if (itemsError) {
            throw itemsError;
          }

          void updateCustomerCrmRecord(customerId);

          clearDraft();
          router.push(`/pos/receipt/${inserted.id}`);
        } catch (cloudErr) {
          if (__DEV__) console.warn(`[OmniPOS] Cloud checkout failed, using offline fallback: ${cloudErr}`);
          await saveOrderOffline(orderNumber, cashierUserId, orderId);
        }
      }
    } catch (error) {
      if (stockAdjusted) {
        try {
          await restoreStockForOrder(activeStoreId, lines, orderId);
        } catch {
          // ignore
        }
      }
      const message =
        error instanceof InsufficientStockError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Failed to create order";
      Alert.alert(error instanceof InsufficientStockError ? "Insufficient Stock" : "Order Creation Failed", message);
    } finally {
      setSubmitting(false);
    }
  }

  const paymentMethods: { key: PaymentMethod; label: string; icon: string }[] = [
    { key: "cash", label: "Cash", icon: "cash-outline" },
    { key: "card", label: "Card", icon: "card-outline" },
    { key: "transfer", label: "Transfer", icon: "send-outline" },
    { key: "momo", label: "MoMo", icon: "phone-portrait-outline" },
  ];

  return (
    <AppScrollScreen showBack title="Order Checkout" subtitle="Complete payment, apply discounts, and assign customer.">
      {/* Total Due Hero Card */}
      <View style={styles.totalHeroCard}>
        <View style={styles.totalHeroHeader}>
          <View style={styles.orderPill}>
            <Text style={styles.orderPillText}>
              {lines.length} {lines.length === 1 ? "Item" : "Items"} in Cart
            </Text>
          </View>
          <Text style={styles.totalHeroCurrency}>{currency}</Text>
        </View>

        <Text style={styles.totalHeroLabel}>TOTAL AMOUNT DUE</Text>
        <Text style={styles.totalHeroValue}>
          {sym} {total.toFixed(2)}
        </Text>

        <View style={styles.totalHeroBreakdown}>
          <Text style={styles.totalHeroBreakdownText}>
            Subtotal: {sym}{subtotal.toFixed(2)}
            {discountAmount > 0 ? ` · Disc: -${sym}${discountAmount.toFixed(2)}` : ""}
            {tax > 0 ? ` · Tax: ${sym}${tax.toFixed(2)}` : ""}
            {vat > 0 ? ` · VAT: ${sym}${vat.toFixed(2)}` : ""}
          </Text>
        </View>
      </View>

      {/* Payment Method Selector */}
      <SectionCard>
        <Text style={styles.cardSectionTitle}>Select Payment Method</Text>
        <View style={styles.paymentMethodGrid}>
          {paymentMethods.map((m) => {
            const active = paymentMethod === m.key;
            return (
              <Pressable
                key={m.key}
                style={({ pressed }) => [
                  styles.paymentMethodCard,
                  active && styles.paymentMethodCardActive,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => setPaymentMethod(m.key)}
              >
                <View style={[styles.methodIconWrap, active && styles.methodIconWrapActive]}>
                  <Ionicons name={m.icon as any} size={22} color={active ? Colors.white : Colors.primaryBlue} />
                </View>
                <Text style={[styles.paymentMethodLabel, active && styles.paymentMethodLabelActive]}>
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SectionCard>

      {/* Discount & Amount Paid */}
      <SectionCard>
        <Text style={styles.cardSectionTitle}>Discount & Tendered Amount</Text>

        {/* Discount Row */}
        <View style={styles.discountRow}>
          <View style={styles.fieldFlex}>
            <TextInput
              label="Discount Value"
              value={discountValue ? String(discountValue) : ""}
              onChangeText={(v) => setDiscountValue(Number(v) || 0)}
              placeholder="0"
              keyboardType="decimal-pad"
            />
          </View>

          <View style={{ marginTop: 24 }}>
            <Pressable
              style={styles.discountToggleBtn}
              onPress={() => setDiscountMode(discountMode === "percentage" ? "amount" : "percentage")}
            >
              <Text style={styles.discountToggleText}>
                {discountMode === "percentage" ? "% Percent" : `${sym} Flat`}
              </Text>
              <Ionicons name="swap-horizontal" size={14} color={Colors.primaryBlue} />
            </Pressable>
          </View>
        </View>

        {/* Amount Tendered Input */}
        <View style={{ marginTop: Spacing.xs }}>
          <TextInput
            label="Amount Paid by Customer"
            value={amountPaid ? String(amountPaid) : ""}
            onChangeText={(v) => setAmountPaid(Number(v) || 0)}
            placeholder={`${sym} ${total.toFixed(2)}`}
            keyboardType="decimal-pad"
            leftIcon={<Text style={styles.inputPrefix}>{sym}</Text>}
          />
        </View>

        {/* Quick Amount Suggestion Chips */}
        <View style={styles.quickCashRow}>
          <Pressable
            style={({ pressed }) => [styles.quickCashChip, pressed && { opacity: 0.7 }]}
            onPress={() => setAmountPaid(Number(total.toFixed(2)))}
          >
            <Text style={styles.quickCashText}>Exact ({sym}{total.toFixed(2)})</Text>
          </Pressable>
          {tenderSuggestions(total).map((suggested) => (
            <Pressable
              key={`tender-${suggested}`}
              style={({ pressed }) => [styles.quickCashChip, pressed && { opacity: 0.7 }]}
              onPress={() => setAmountPaid(suggested)}
            >
              <Text style={styles.quickCashText}>{sym}{suggested}</Text>
            </Pressable>
          ))}
        </View>

        {/* Change & Balance Indicator */}
        <View style={styles.changeOverviewBox}>
          <View style={styles.changeRowItem}>
            <Text style={styles.changeRowLabel}>Change to Return</Text>
            <Text style={[styles.changeRowValue, { color: Colors.success }]}>
              {sym} {change.toFixed(2)}
            </Text>
          </View>
          {balance > 0 ? (
            <View style={styles.changeRowItem}>
              <Text style={styles.changeRowLabel}>Balance Remaining</Text>
              <Text style={[styles.changeRowValue, { color: Colors.accentOrange }]}>
                {sym} {balance.toFixed(2)}
              </Text>
            </View>
          ) : null}
        </View>
      </SectionCard>

      {/* Customer Information (Collapsible) */}
      <SectionCard>
        <Pressable
          style={styles.customerHeaderRow}
          onPress={() => setCustomerOpen((v) => !v)}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="person-circle-outline" size={22} color={Colors.primaryBlue} />
            <Text style={styles.cardSectionTitle}>Customer Information</Text>
            {customerId ? (
              <View style={styles.assignedBadge}>
                <Text style={styles.assignedBadgeText}>Saved Client</Text>
              </View>
            ) : (
              <Text style={styles.optionalTag}>(Optional / Credit)</Text>
            )}
          </View>
          <Ionicons
            name={customerOpen ? "chevron-up" : "chevron-down"}
            size={20}
            color={Colors.textMuted}
          />
        </Pressable>

        {customerOpen ? (
          <View style={styles.customerFields}>
            {/* Auto-suggest Matched Customers */}
            {matchedCustomers.length > 0 && !customerId ? (
              <View style={styles.suggestBox}>
                <Text style={styles.suggestTitle}>Matching Existing Clients:</Text>
                <View style={styles.suggestChipRow}>
                  {matchedCustomers.map((mc) => (
                    <Pressable
                      key={mc.id}
                      style={({ pressed }) => [styles.suggestChip, pressed && { opacity: 0.7 }]}
                      onPress={() => selectExistingCustomer(mc)}
                    >
                      <Ionicons name="person" size={12} color={Colors.primaryBlue} />
                      <Text style={styles.suggestChipName}>{mc.name}</Text>
                      {mc.phone ? <Text style={styles.suggestChipPhone}>({mc.phone})</Text> : null}
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={{ position: "relative" }}>
              <TextInput
                label="Customer Full Name"
                value={customerName}
                onChangeText={(name) => setCustomer({ name, id: undefined })}
                placeholder="Walk-in Customer / Client Name"
                leftIcon={<Ionicons name="person-outline" size={18} color={Colors.textMuted} />}
                rightIcon={
                  customerId ? (
                    <Pressable
                      onPress={() => setCustomer({ name: "", phone: "", id: undefined })}
                      hitSlop={10}
                    >
                      <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
                    </Pressable>
                  ) : undefined
                }
              />
            </View>

            <TextInput
              label="Phone Number"
              value={customerPhone}
              onChangeText={(phone) => setCustomer({ phone })}
              placeholder="e.g. +233 24 000 0000"
              keyboardType="phone-pad"
              leftIcon={<Ionicons name="call-outline" size={18} color={Colors.textMuted} />}
            />

            <TextInput
              label="Shipping / Delivery Address"
              value={shippingAddress}
              onChangeText={(shipping) => setCustomer({ shippingAddress: shipping })}
              placeholder="House number, street, landmark (Optional)"
              leftIcon={<Ionicons name="location-outline" size={18} color={Colors.textMuted} />}
            />

            {!customerId && customerName.trim() ? (
              <View style={styles.saveToggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.saveToggleLabel}>Save customer to store directory</Text>
                  <Text style={styles.saveToggleSub}>Allows tracking total spend, loyalty, and store credit.</Text>
                </View>
                <Switch
                  value={saveToCrm}
                  onValueChange={setSaveToCrm}
                  trackColor={{ false: "#e2e8f0", true: Colors.primaryBlueLight }}
                  thumbColor={saveToCrm ? Colors.primaryBlue : "#cbd5e1"}
                />
              </View>
            ) : null}
          </View>
        ) : (
          <Text style={styles.customerClosedHint}>
            {customerName
              ? `Assigned to: ${customerName}${customerPhone ? ` (${customerPhone})` : ""}`
              : "Walk-in sale (Full payment). Tap to assign customer for credit/partial payment."}
          </Text>
        )}
      </SectionCard>

      {/* Complete Order Primary Button */}
      <View style={styles.bottomActionContainer}>
        <Pressable
          style={({ pressed }) => [
            styles.submitOrderButton,
            submitting && styles.submitOrderButtonDisabled,
            pressed && styles.submitOrderButtonPressed,
          ]}
          disabled={submitting}
          onPress={() => void createReceipt()}
        >
          <View style={styles.submitLeft}>
            <Ionicons name="receipt-outline" size={22} color={Colors.white} />
            <Text style={styles.submitButtonText}>
              {submitting ? "Processing Sale..." : "Complete & Generate Receipt"}
            </Text>
          </View>
          <Text style={styles.submitButtonTotal}>{sym} {total.toFixed(2)}</Text>
        </Pressable>
      </View>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  totalHeroCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  totalHeroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  orderPill: {
    backgroundColor: Colors.primaryBluePale,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: "rgba(7, 103, 222, 0.15)",
  },
  orderPillText: {
    color: Colors.primaryBlue,
    fontSize: 12,
    fontWeight: "700",
  },
  totalHeroCurrency: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
  totalHeroLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginTop: Spacing.xs,
  },
  totalHeroValue: {
    color: Colors.navy,
    fontSize: 34,
    fontWeight: "900",
    marginTop: 2,
    letterSpacing: -0.5,
  },
  totalHeroBreakdown: {
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    marginTop: Spacing.sm,
    paddingTop: Spacing.xs,
  },
  totalHeroBreakdownText: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  cardSectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  paymentMethodGrid: {
    flexDirection: "row",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  paymentMethodCard: {
    flex: 1,
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    paddingVertical: Spacing.md,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    gap: 6,
  },
  paymentMethodCardActive: {
    backgroundColor: Colors.primaryBlue,
    borderColor: Colors.primaryBlue,
  },
  methodIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  methodIconWrapActive: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  paymentMethodLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  paymentMethodLabelActive: {
    color: Colors.white,
  },
  discountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  fieldFlex: {
    flex: 1,
  },
  discountToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: Radius.input,
    backgroundColor: Colors.primaryBluePale,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  discountToggleText: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  inputPrefix: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.primaryBlue,
    paddingHorizontal: 4,
  },
  quickCashRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  quickCashChip: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  quickCashText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  changeOverviewBox: {
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  changeRowItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  changeRowLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  changeRowValue: {
    fontSize: 18,
    fontWeight: "900",
  },
  customerHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  optionalTag: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: "400",
  },
  assignedBadge: {
    backgroundColor: "#eff6ff",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  assignedBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  suggestBox: {
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    gap: 6,
  },
  suggestTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textSecondary,
    textTransform: "uppercase",
  },
  suggestChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  suggestChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  suggestChipName: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  suggestChipPhone: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  saveToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.background,
    padding: Spacing.sm,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginTop: 4,
  },
  saveToggleLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  saveToggleSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  customerClosedHint: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },
  customerFields: {
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  bottomActionContainer: {
    marginTop: Spacing.xs,
    marginBottom: Spacing.xl,
  },
  submitOrderButton: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.primaryBlue,
    borderRadius: Radius.pill,
    paddingVertical: 16,
    paddingHorizontal: Spacing.lg,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  submitOrderButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  submitOrderButtonDisabled: {
    opacity: 0.6,
  },
  submitLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.white,
  },
  submitButtonTotal: {
    fontSize: 16,
    fontWeight: "900",
    color: Colors.white,
  },
});
