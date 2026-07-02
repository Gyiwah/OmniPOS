import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { getReturnDetail } from "@/src/features/returns/service";
import type { ReturnDetail } from "@/src/features/returns/types";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";

function money(value: number, currency: string) {
  const symbol = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";
  return `${symbol} ${value.toFixed(2)}`;
}

export default function ReturnDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const returnId = Array.isArray(id) ? id[0] : id;
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const currency = useSettingsStore((s) => s.currency);
  const router = useRouter();

  const [detail, setDetail] = useState<ReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!activeStoreId || !returnId) {
        if (mounted) {
          setDetail(null);
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      try {
        const row = await getReturnDetail(activeStoreId, returnId);
        if (!mounted) return;
        if (!row) {
          setErrorMessage("Return not found.");
          setDetail(null);
        } else {
          setDetail(row);
          setErrorMessage(null);
        }
      } catch (error) {
        if (!mounted) return;
        setDetail(null);
        setErrorMessage(error instanceof Error ? error.message : "Failed to load return");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [activeStoreId, returnId]);

  return (
    <AppScrollScreen showBack title="Return detail" subtitle={detail?.orderNumber ?? returnId ?? "Return"}>
      {loading ? <Text style={styles.muted}>Loading return...</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      {detail ? (
        <>
          <SectionCard>
            <Text style={styles.label}>Order</Text>
            <Text style={styles.value}>{detail.orderNumber}</Text>
            <Text style={styles.label}>Processed</Text>
            <Text style={styles.value}>{new Date(detail.createdAt).toLocaleString()}</Text>
            <Text style={styles.label}>Reason</Text>
            <Text style={styles.value}>{detail.reason || "—"}</Text>
            <Text style={styles.label}>Refund total</Text>
            <Text style={styles.refund}>{money(detail.amount, currency)}</Text>
          </SectionCard>

          <SectionCard>
            <Text style={styles.sectionTitle}>Returned items</Text>
            <View style={styles.list}>
              {detail.items.length > 0 ? (
                detail.items.map((item) => (
                  <View key={item.id} style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemMeta}>
                        {item.quantity} × {money(item.unitPrice, currency)}
                      </Text>
                    </View>
                    <Text style={styles.lineTotal}>{money(item.lineTotal, currency)}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.muted}>Line items were not stored for this return.</Text>
              )}
            </View>
          </SectionCard>

          <Text style={styles.link} onPress={() => router.push(`/pos/receipt/${detail.orderId}`)}>
            View original receipt
          </Text>
        </>
      ) : null}
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  label: {
    color: Colors.textMuted,
    marginTop: Spacing.sm,
  },
  value: {
    color: Colors.textPrimary,
    fontWeight: "600",
  },
  refund: {
    color: Colors.accentOrange,
    fontWeight: "800",
    fontSize: 24,
    marginTop: Spacing.xs,
  },
  list: {
    gap: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  itemName: {
    color: Colors.textPrimary,
    fontWeight: "600",
  },
  itemMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  lineTotal: {
    color: Colors.textPrimary,
    fontWeight: "700",
  },
  muted: {
    color: Colors.textMuted,
    textAlign: "center",
    paddingVertical: Spacing.md,
  },
  error: {
    color: Colors.danger,
    textAlign: "center",
    paddingVertical: Spacing.md,
  },
  link: {
    textAlign: "center",
    color: Colors.primaryBlue,
    fontWeight: "700",
    marginTop: Spacing.md,
  },
});
