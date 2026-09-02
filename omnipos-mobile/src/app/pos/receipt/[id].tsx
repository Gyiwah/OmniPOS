import { useLocalSearchParams } from "expo-router";
import { Pressable, Text, View, Alert } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";

import { AppScrollScreen } from "@/src/components/layout/AppScrollScreen";
import { type ReceiptData, ReceiptDocument } from "@/src/components/organisms/ReceiptDocument";
import { Colors } from "@/src/constants/colors";
import { usePrintReceipt } from "@/src/features/printer/hooks";
import type { PrintableReceipt } from "@/src/core/printing/receipt";
import { supabase } from "@/src/services/supabase";
import { useSettingsStore, UNNAMED_STORE } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";
import { toErrorMessage } from "@/src/utils/errors";

import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Q } from "@nozbe/watermelondb";

import { database } from "@/src/database";
import type Order from "@/src/database/models/Order";
import type OrderItem from "@/src/database/models/OrderItem";

import { shareReceiptAsPdf } from "@/src/utils/receiptPdf";
import { usingLaravel } from "@/src/core/api/config";

type OrderRow = {
  id: string;
  order_number: string;
  created_at: string;
  discount_mode: "percentage" | "amount";
  discount_value: number;
  amount_paid: number;
  change_due: number;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  payment_method: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  shipping_address: string | null;
  tax_rate: number;
  vat_rate: number;
  service_rate: number;
};

type ItemRow = {
  id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
};

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const settingsCurrency = useSettingsStore((s) => s.currency);
  const shopName = useSettingsStore((s) => s.shopName);
  const printReceipt = usePrintReceipt();
  const ref = Array.isArray(id) ? id[0] : id ?? "—";
  const [remoteData, setRemoteData] = useState<ReceiptData | undefined>(undefined);
  const [dateLabel, setDateLabel] = useState<string | undefined>(undefined);
  const [orderNumber, setOrderNumber] = useState<string>(String(ref));
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function loadRemoteOrder() {
      if (!activeStoreId || !ref || ref === "—") return;
      setLoading(true);
      setErrorMessage(null);

      /*
       * Supabase only. Under Laravel this falls through to the local copy
       * below, which is the right source anyway: a receipt is reprinted on the
       * till that issued it, and that till must be able to reprint with no
       * connection at all.
       */
      const { data: order, error } = usingLaravel
        ? { data: null, error: null }
        : await supabase
            .from("orders")
            .select(
              "id, order_number, created_at, discount_mode, discount_value, amount_paid, change_due, subtotal, tax, discount, total, payment_method, customer_name, customer_phone, shipping_address, tax_rate, vat_rate, service_rate",
            )
            .eq("store_id", activeStoreId)
            .eq("id", ref)
            .maybeSingle<OrderRow>();

      if (error || !order) {
        // Fallback: Check WatermelonDB SQLite for offline order
        try {
          const localOrders = await database.get<Order>("orders").query(Q.where("store_id", activeStoreId), Q.where("id", ref)).fetch();
          const localMatch = localOrders[0];
          if (localMatch) {
            const localItems = await database.get<OrderItem>("order_items").query(Q.where("order_id", localMatch.id)).fetch();
            if (!mounted) return;
            setOrderNumber(localMatch.orderNumber);
            setDateLabel(new Date(localMatch.createdAt).toLocaleString());
            setRemoteData({
              lines: localItems.map((item) => ({
                id: item.id,
                name: item.productName,
                price: Number(item.unitPrice),
                quantity: Number(item.quantity),
              })),
              discountMode: "amount",
              discountValue: Number(localMatch.discount ?? 0),
              amountPaid: Number(localMatch.amountPaid ?? 0),
              charged: {
                subtotal: Number(localMatch.subtotal ?? 0),
                discount: Number(localMatch.discount ?? 0),
                tax: Number(localMatch.tax ?? 0),
                total: Number(localMatch.total ?? 0),
                changeDue: Number(localMatch.changeDue ?? 0),
              },
              paymentMethod: localMatch.paymentMethod,
              customerName: localMatch.customerName,
              customerPhone: localMatch.customerPhone,
              shippingAddress: undefined,
              taxRate: 0,
              vatRate: 0,
              serviceRate: 0,
              currency: settingsCurrency,
            });
            setLoading(false);
            return;
          }
        } catch {
          // ignore local fallback error
        }

        if (!mounted) return;
        setRemoteData(undefined);
        const message = error?.message ?? "Order not found.";
        setErrorMessage(message);
        setLoading(false);
        return;
      }

      const { data: items } = await supabase
        .from("order_items")
        .select("id, product_name, unit_price, quantity")
        .eq("order_id", order.id)
        .eq("store_id", activeStoreId)
        .returns<ItemRow[]>();

      if (!mounted) return;

      setOrderNumber(order.order_number);
      setDateLabel(new Date(order.created_at).toLocaleString());
      setRemoteData({
        lines: (items ?? []).map((item) => ({
          id: item.id,
          name: item.product_name,
          price: Number(item.unit_price),
          quantity: Number(item.quantity),
        })),
        discountMode: order.discount_mode,
        discountValue: Number(order.discount_value ?? 0),
        amountPaid: Number(order.amount_paid ?? 0),
        // What the sale was booked at, rather than what today's rates would make it.
        charged: {
          subtotal: Number(order.subtotal ?? 0),
          discount: Number(order.discount ?? 0),
          tax: Number(order.tax ?? 0),
          total: Number(order.total ?? 0),
          changeDue: Number(order.change_due ?? 0),
        },
        paymentMethod: order.payment_method,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        shippingAddress: order.shipping_address,
        taxRate: Number(order.tax_rate ?? 0),
        vatRate: Number(order.vat_rate ?? 0),
        serviceRate: Number(order.service_rate ?? 0),
        currency: settingsCurrency,
      });
      setLoading(false);
    }
    void loadRemoteOrder();
    return () => {
      mounted = false;
    };
  }, [activeStoreId, ref, settingsCurrency, reloadNonce]);

  async function onPrintReceipt() {
    if (!remoteData) return;

    const charged = remoteData.charged;
    if (!charged) {
      Alert.alert(
        "Cannot print this one",
        "This sale predates the figures a receipt needs. Open it on the web till, or share it as a PDF.",
      );
      return;
    }

    try {
      /*
       * Built from what was charged, never recomputed. The previous version
       * passed the store's tax rates and let the layout derive the totals,
       * which printed today's VAT on a sale made before it changed.
       */
      const receipt: PrintableReceipt = {
        orderNumber,
        dateLabel: dateLabel ?? new Date().toLocaleString(),
        lines: remoteData.lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          lineTotal: line.price * line.quantity,
        })),
        subtotal: charged.subtotal,
        discount: charged.discount,
        tax: charged.tax,
        total: charged.total,
        amountPaid: remoteData.amountPaid,
        changeDue: charged.changeDue,
        /*
         * One tender, because this till has only ever taken one per sale. It
         * used to print "Other" regardless — so a cash sale reprinted on a
         * phone showed a tender nobody had used, and the customer could not
         * check the receipt against how they had paid.
         */
        tenders: [{
          method: remoteData.paymentMethod || "cash",
          amount: Math.min(remoteData.amountPaid, charged.total),
        }],
        customerName: remoteData.customerName,
      };

      // Anything opened from this screen is a second copy by definition — the
      // first was printed at the till when the sale was rung up.
      await printReceipt.mutateAsync({ receipt, reprint: true });
      Alert.alert("Receipt sent", "Marked as a reprint so it cannot be taken for a second sale.");
    } catch (err) {
      Alert.alert("Print failed", toErrorMessage(err, "Could not print receipt."));
    }
  }

  async function onShareReceipt() {
    if (!remoteData) return;
    await shareReceiptAsPdf({
      shopName: shopName || UNNAMED_STORE,
      orderNumber,
      dateLabel: dateLabel ?? new Date().toLocaleString(),
      data: remoteData,
    });
  }

  return (
    <AppScrollScreen
      showBack
      title="Order Receipt"
      subtitle={`Reference · ${ref}`}
      right={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            hitSlop={8}
            onPress={() => void onPrintReceipt()}
            style={({ pressed }) => [
              {
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: Colors.primaryBluePale,
                alignItems: "center",
                justifyContent: "center",
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons name="print-outline" size={20} color={Colors.primaryBlue} />
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={() => void onShareReceipt()}
            style={({ pressed }) => [
              {
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: "#dcfce7",
                alignItems: "center",
                justifyContent: "center",
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons name="share-social-outline" size={20} color="#16a34a" />
          </Pressable>
        </View>
      }
    >
      {loading ? (
        <Text>Loading receipt...</Text>
      ) : errorMessage ? (
        <View style={{ gap: 12 }}>
          <Text>{errorMessage.toLowerCase().includes("network") ? "You appear offline. Reconnect and retry." : errorMessage}</Text>
          <Pressable
            onPress={() => {
              setReloadNonce((x) => x + 1);
            }}
          >
            <Text style={{ color: Colors.primaryBlue, fontWeight: "700" }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ReceiptDocument
          store={{ name: shopName || UNNAMED_STORE }}
          order={{
            orderNumber,
            dateLabel: dateLabel ?? "—",
          }}
          data={remoteData}
          onPrint={() => void onPrintReceipt()}
          onShare={() => void onShareReceipt()}
        />
      )}
    </AppScrollScreen>
  );
}
