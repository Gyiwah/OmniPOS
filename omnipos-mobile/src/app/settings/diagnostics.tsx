import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";

import { AppScrollScreen } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { useStoreSlice } from "@/src/store/storeSlice";
import { asReport, runDiagnostics, summarise, type CheckResult, type CheckStatus } from "@/src/features/diagnostics/checks";

const LOOK: Record<CheckStatus, { icon: keyof typeof Ionicons.glyphMap; colour: string; label: string }> = {
  pass: { icon: "checkmark-circle", colour: Colors.success, label: "OK" },
  fail: { icon: "close-circle", colour: Colors.danger, label: "Failed" },
  warn: { icon: "alert-circle", colour: Colors.warning, label: "Check" },
  skip: { icon: "remove-circle-outline", colour: Colors.textMuted, label: "Skipped" },
};

/**
 * What this device can tell you about itself.
 *
 * Built for hardware testing, where almost every failure presents the same way —
 * "network request failed", which this app reports as "offline". A till that
 * looks like it is happily working offline is the most expensive thing to
 * diagnose, because nothing on screen is wrong.
 *
 * Every failure here carries what to do about it, and the whole run can be
 * shared as text so a tester on a shop floor can send it without a screenshot.
 */
export default function DiagnosticsScreen() {
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);

  const [results, setResults] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      setResults(await runDiagnostics(activeStoreId ?? null));
    } finally {
      setRunning(false);
    }
  }, [activeStoreId]);

  useFocusEffect(
    useCallback(() => {
      void run();
    }, [run]),
  );

  const failures = results.filter((r) => r.status === "fail");

  return (
    <AppScrollScreen title="Device check" subtitle="Run this first on new hardware" showBack onRefresh={run}>
      {running && results.length === 0 ? (
        <ActivityIndicator color={Colors.primaryBlue} style={{ marginTop: Spacing.lg }} />
      ) : null}

      {results.length > 0 ? (
        <>
          <View style={[styles.summary, failures.length > 0 && styles.summaryBad]}>
            <Ionicons
              name={failures.length > 0 ? "warning-outline" : "checkmark-circle-outline"}
              size={22}
              color={failures.length > 0 ? Colors.danger : Colors.success}
            />
            <Text style={styles.summaryText}>{summarise(results)}</Text>
          </View>

          {results.map((result) => {
            const look = LOOK[result.status];

            return (
              <View key={result.id} style={styles.row}>
                <Ionicons name={look.icon} size={20} color={look.colour} style={styles.rowIcon} />
                <View style={styles.rowBody}>
                  <View style={styles.rowHead}>
                    <Text style={styles.rowTitle}>{result.title}</Text>
                    {result.ms !== undefined ? <Text style={styles.rowMs}>{result.ms}ms</Text> : null}
                  </View>
                  <Text style={styles.rowDetail}>{result.detail}</Text>
                  {/*
                    The remedy is the whole point. A check that only says
                    "failed" leaves a tester with the same problem they had
                    before they opened this screen.
                  */}
                  {result.remedy ? <Text style={styles.rowRemedy}>{result.remedy}</Text> : null}
                </View>
              </View>
            );
          })}

          <View style={styles.actions}>
            <Pressable style={[styles.button, styles.primary]} disabled={running} onPress={() => void run()}>
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.primaryText}>{running ? "Checking…" : "Run again"}</Text>
            </Pressable>

            <Pressable
              style={[styles.button, styles.secondary]}
              onPress={() => void Share.share({ message: asReport(results) })}
            >
              <Ionicons name="share-outline" size={18} color={Colors.textPrimary} />
              <Text style={styles.secondaryText}>Share the report</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  summaryBad: { borderColor: Colors.danger },
  summaryText: { fontWeight: "700", color: Colors.textPrimary, flexShrink: 1 },

  row: {
    flexDirection: "row",
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  rowIcon: { marginTop: 1 },
  rowBody: { flex: 1, gap: 2 },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: Spacing.sm },
  rowTitle: { fontWeight: "700", color: Colors.textPrimary, flexShrink: 1 },
  rowMs: { color: Colors.textMuted, fontSize: 12 },
  rowDetail: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  rowRemedy: {
    color: Colors.navy,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    paddingLeft: Spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: Colors.primaryBlue,
  },

  actions: { gap: Spacing.sm, marginTop: Spacing.md },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  primary: { backgroundColor: Colors.primaryBlue },
  primaryText: { color: "#fff", fontWeight: "700" },
  secondary: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  secondaryText: { color: Colors.textPrimary, fontWeight: "600" },
});
