import { useLocalSearchParams } from "expo-router";
import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";

import { AppScrollScreen } from "@/src/components/layout/AppScrollScreen";
import { type ReceiptData, ReceiptDocument } from "@/src/components/organisms/ReceiptDocument";
import { Colors } from "@/src/constants/colors";
import { supabase } from "@/src/services/supabase";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";

type OrderRow = {
  id: string;
  order_number: string;
  created_at: string;
  discount_mode: "percentage" | "amount";
  discount_value: number;
  amount_paid: number;
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

      const { data: order, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, created_at, discount_mode, discount_value, amount_paid, customer_name, customer_phone, shipping_address, tax_rate, vat_rate, service_rate",
        )
        .eq("store_id", activeStoreId)
        .eq("id", ref)
        .single<OrderRow>();

      if (error || !order) {
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

  return (
    <AppScrollScreen
      showBack
      title="Order Receipt"
      subtitle={`Reference · ${ref}`}
      right={
        <Pressable hitSlop={8}>
          <Ionicons name="qr-code-outline" size={24} color={Colors.textSecondary} />
        </Pressable>
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
          store={{ name: shopName }}
          order={{
            orderNumber,
            dateLabel: dateLabel ?? "—",
          }}
          data={remoteData}
          onPrint={() => {}}
          onShare={() => {}}
        />
      )}
    </AppScrollScreen>
  );
}
