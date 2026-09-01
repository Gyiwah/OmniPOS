import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { AppScrollScreen } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { useStoreSlice } from "@/src/store/storeSlice";
import { useSettingsStore } from "@/src/store/settingsStore";
import { usingLaravel } from "@/src/core/api/config";
import { synchronise } from "@/src/sync";
import {
  acknowledgeOnServer,
  discardOperation,
  listConflicts,
  reissueOrder,
  retryOperation,
  type ConflictView,
} from "@/src/sync/laravelResolve";
import { toErrorMessage } from "@/src/utils/errors";

/**
 * Sales the server refused.
 *
 * Until this screen existed a rejected sale sat in the queue with no way out on
 * the device that took the money. The cashier saw nothing, and the only remedy
 * was a manager on the web till. A phone used on its own had no remedy at all.
 *
 * Nothing here is deleted quietly. A rejected sale is money that changed hands
 * and a receipt someone is holding, so every option leaves a trace.
 */
export default function ConflictsScreen() {
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const { currency } = useSettingsStore();
  const sym = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";

  const [conflicts, setConflicts] = useState<ConflictView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeStoreId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setConflicts(await listConflicts(activeStoreId));
    } finally {
      setLoading(false);
    }
  }, [activeStoreId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const settle = async (
    conflict: ConflictView,
    resolution: "reissued" | "retried" | "discarded",
    run: () => Promise<string>,
  ) => {
    setBusyId(conflict.operationId);
    setNotice(null);
    try {
      const message = await run();

      // Best effort. The local resolution has already happened and must not be
      // undone because the connection is down.
      await acknowledgeOnServer(conflict.operationId, resolution);

      setNotice(message);
      if (activeStoreId) void synchronise(activeStoreId);
      await load();
    } catch (error) {
      Alert.alert("Could not settle this", toErrorMessage(error, "That did not work."));
    } finally {
      setBusyId(null);
    }
  };

  const onReissue = (c: ConflictView) =>
    settle(c, "reissued", async () => {
      const { from, to } = await reissueOrder(c.operationId);
      return `Re-issued ${from} as ${to}. Give the customer the new number if they ask.`;
    });

  const onRetry = (c: ConflictView) =>
    settle(c, "retried", async () => {
      await retryOperation(c.operationId);
      return "Queued again, unchanged.";
    });

  const onDiscard = (c: ConflictView) => {
    Alert.alert(
      "Discard this sale?",
      "It will stop counting as a booked sale but stays on the device as a record. Only do this if the sale is already on the server from another till, or was entered twice.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () =>
            void settle(c, "discarded", async () => {
              await discardOperation(c.operationId);
              return "Discarded. It is kept on this device as a record.";
            }),
        },
      ],
    );
  };

  if (!usingLaravel) {
    return (
      <AppScrollScreen title="Rejected sales" showBack>
        <Text style={styles.muted}>
          This till is running against Supabase, which does not report conflicts. Nothing to settle here.
        </Text>
      </AppScrollScreen>
    );
  }

  return (
    <AppScrollScreen title="Rejected sales" subtitle="Waiting for a decision" showBack onRefresh={load}>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {loading ? (
        <ActivityIndicator color={Colors.primaryBlue} style={{ marginTop: Spacing.lg }} />
      ) : conflicts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing to settle</Text>
          <Text style={styles.muted}>
            Every sale this till has taken is on the server, or still on its way there.
          </Text>
        </View>
      ) : (
        conflicts.map((c) => (
          <View key={c.operationId} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{c.order?.orderNumber ?? c.entity}</Text>
              {c.order ? (
                <Text style={styles.amount}>
                  {sym}
                  {c.order.total.toFixed(2)}
                </Text>
              ) : null}
            </View>

            <Text style={styles.reason}>{c.reason}</Text>

            {c.order ? (
              <Text style={styles.muted}>
                {c.order.customerName ?? "Walk-in"} · {new Date(c.order.createdAt).toLocaleString()}
                {c.order.amountPaid < c.order.total
                  ? ` · ${sym}${(c.order.total - c.order.amountPaid).toFixed(2)} left on account`
                  : ""}
              </Text>
            ) : null}

            <View style={styles.actions}>
              {c.entity === "orders" ? (
                <Pressable
                  style={[styles.button, styles.primary]}
                  disabled={busyId === c.operationId}
                  onPress={() => void onReissue(c)}
                >
                  <Text style={styles.primaryText}>Re-issue under a new number</Text>
                </Pressable>
              ) : null}

              <Pressable
                style={[styles.button, styles.secondary]}
                disabled={busyId === c.operationId}
                onPress={() => void onRetry(c)}
              >
                <Text style={styles.secondaryText}>Try again unchanged</Text>
              </Pressable>

              <Pressable
                style={[styles.button, styles.secondary]}
                disabled={busyId === c.operationId}
                onPress={() => onDiscard(c)}
              >
                <Text style={styles.dangerText}>Discard</Text>
              </Pressable>
            </View>

            {/*
              Spelled out because the choice is not obvious from the words
              alone, and picking wrong either loses a sale or books it twice.
            */}
            <Text style={styles.hint}>
              Re-issue when both sales are real and only the receipt number clashed. Try again when the cause has
              since been fixed. Discard only when this sale is already on the books from another till.
            </Text>
          </View>
        ))
      )}
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.danger,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.xs,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: Spacing.sm },
  cardTitle: { fontSize: 16, fontWeight: "700", color: Colors.textPrimary, flexShrink: 1 },
  amount: { fontSize: 16, fontWeight: "700", color: Colors.primaryBlue },
  reason: { color: Colors.danger, fontSize: 13 },
  muted: { color: Colors.textSecondary, fontSize: 13 },
  hint: { color: Colors.textMuted, fontSize: 12, marginTop: Spacing.xs, lineHeight: 17 },
  notice: {
    backgroundColor: Colors.primaryBluePale,
    color: Colors.navy,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    marginBottom: Spacing.md,
  },
  // Full-width stacked buttons: the labels are sentences, and squeezing three
  // of them onto one row is how a manager taps Discard meaning Re-issue.
  actions: { gap: Spacing.xs, marginTop: Spacing.xs },
  button: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.md, alignItems: "center" },
  primary: { backgroundColor: Colors.primaryBlue },
  primaryText: { color: "#fff", fontWeight: "700" },
  secondary: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  secondaryText: { color: Colors.textPrimary, fontWeight: "600" },
  dangerText: { color: Colors.danger, fontWeight: "600" },
  empty: { alignItems: "center", paddingVertical: Spacing.xl, gap: Spacing.xs },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: Colors.textPrimary },
});
