import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
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
          setErrorMessage("Return record not found.");
          setDetail(null);
        } else {
          setDetail(row);
          setErrorMessage(null);
        }
      } catch (error) {
        if (!mounted) return;
        setDetail(null);
        setErrorMessage(error instanceof Error ? error.message : "Failed to load return details");
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
    <AppScrollScreen
      showBack
      title="Return Voucher"
      subtitle={detail ? `Order #${detail.orderNumber}` : "Refund Record"}
    >
      {loading ? (
        <SectionCard>
          <ActivityIndicator size="small" color={Colors.primaryBlue} />
          <Text style={styles.loadingText}>Loading return voucher...</Text>
        </SectionCard>
      ) : null}

      {errorMessage ? (
        <SectionCard>
          <Text style={styles.error}>{errorMessage}</Text>
        </SectionCard>
      ) : null}

      {detail ? (
        <>
          {/* Refund Hero Card */}
          <View style={styles.heroCard}>
            <View style={styles.heroHeader}>
              <View style={styles.heroBadge}>
                <Ionicons name="return-down-back" size={14} color="#dc2626" />
                <Text style={styles.heroBadgeText}>Refund Processed</Text>
              </View>
              <Text style={styles.heroDate}>
                {new Date(detail.createdAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
              </Text>
            </View>

            <Text style={styles.heroLabel}>TOTAL REFUND ISSUED</Text>
            <Text style={styles.heroAmount}>{money(detail.amount, currency)}</Text>

            <View style={styles.heroDetails}>
              <View style={styles.heroRow}>
                <Text style={styles.heroRowLabel}>Original Order:</Text>
                <Text style={styles.heroRowVal}>#{detail.orderNumber}</Text>
              </View>
              <View style={styles.heroRow}>
                <Text style={styles.heroRowLabel}>Reason for Return:</Text>
                <Text style={styles.heroRowVal}>{detail.reason || "Standard return"}</Text>
              </View>
            </View>
          </View>

          {/* Returned Items Table */}
          <SectionCard>
            <Text style={styles.sectionTitle}>Restocked / Returned Items</Text>

            <View style={styles.tableWrap}>
              {detail.items.length > 0 ? (
                detail.items.map((item) => (
                  <View key={item.id} style={styles.itemRow}>
                    <View style={styles.itemLeft}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemMultiplier}>
                        {item.quantity} units × {money(item.unitPrice, currency)}
                      </Text>
                    </View>
                    <Text style={styles.lineTotal}>{money(item.lineTotal, currency)}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.loadingText}>Items summary not available.</Text>
              )}
            </View>
          </SectionCard>

          {/* Actions */}
          <View style={styles.actionRow}>
            <Pressable
              style={({ pressed }) => [styles.receiptLinkBtn, pressed && { opacity: 0.8 }]}
              onPress={() => router.push(`/pos/receipt/${detail.orderId}`)}
            >
              <Ionicons name="receipt-outline" size={18} color={Colors.primaryBlue} />
              <Text style={styles.receiptLinkText}>View Original Sale Receipt</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  loadingText: {
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: Spacing.xs,
  },
  error: {
    color: Colors.danger,
    textAlign: "center",
    fontWeight: "700",
  },
  heroCard: {
    backgroundColor: "#fff1f2",
    borderRadius: Radius.card,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: "#fecdd3",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  heroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fee2e2",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  heroBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#dc2626",
  },
  heroDate: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#9f1239",
    letterSpacing: 0.5,
    marginTop: Spacing.md,
  },
  heroAmount: {
    fontSize: 32,
    fontWeight: "900",
    color: Colors.danger,
    marginTop: 2,
  },
  heroDetails: {
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: "#fecdd3",
    gap: 4,
  },
  heroRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroRowLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  heroRowVal: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  sectionTitle: {
    ...Typography.title,
    fontSize: 16,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  tableWrap: {
    gap: Spacing.xs,
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  itemLeft: {
    flex: 1,
    gap: 2,
  },
  itemName: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  itemMultiplier: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  lineTotal: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  actionRow: {
    marginTop: Spacing.xs,
    marginBottom: Spacing.xl,
  },
  receiptLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: Colors.primaryBlue,
  },
  receiptLinkText: {
    color: Colors.primaryBlue,
    fontSize: 14,
    fontWeight: "700",
  },
});
