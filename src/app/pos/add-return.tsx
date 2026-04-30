import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { BarcodeScanner } from "@/src/components/organisms/BarcodeScanner";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { MOCK_ORDER_LINES } from "@/src/lib/uiMock";

export default function AddReturnScreen() {
  const [orderRef, setOrderRef] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [reason, setReason] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(MOCK_ORDER_LINES.map((row) => [row.id, 0])),
  );

  const totalItems = useMemo(
    () => Object.values(counts).reduce((sum, next) => sum + next, 0),
    [counts],
  );

  function updateCount(id: string, next: number) {
    setCounts((current) => ({
      ...current,
      [id]: Math.max(0, next),
    }));
  }

  return (
    <AppScrollScreen showBack title="Process return" subtitle="Match receipt/order and select item counts.">
      <SectionCard>
        <TextInput
          label="Receipt / order #"
          value={orderRef}
          onChangeText={setOrderRef}
          placeholder="ORD-1042 or receipt code"
          rightIcon={
            <Pressable onPress={() => setShowScanner((v) => !v)} hitSlop={10}>
              <Ionicons
                name={showScanner ? "close-circle-outline" : "scan-outline"}
                size={22}
                color={Colors.primaryBlue}
              />
            </Pressable>
          }
        />
        {showScanner ? (
          <BarcodeScanner
            label="Align receipt or order barcode inside frame"
            onScan={(payload) => {
              setOrderRef(payload);
              setShowScanner(false);
            }}
          />
        ) : null}
        <TextInput label="Reason" value={reason} onChangeText={setReason} placeholder="Damaged, wrong item, …" />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Items to refund</Text>
        <View style={styles.itemsWrap}>
          {MOCK_ORDER_LINES.map((line) => (
            <View key={line.id} style={styles.returnRow}>
              <View style={styles.meta}>
                <Text style={styles.name}>{line.name}</Text>
                <Text style={styles.sub}>
                  Purchased {line.quantity} · {line.unitPriceLabel}
                </Text>
              </View>
              <View style={styles.counter}>
                <Pressable
                  onPress={() => updateCount(line.id, (counts[line.id] ?? 0) - 1)}
                  style={styles.counterBtn}
                >
                  <Text style={styles.counterBtnText}>-</Text>
                </Pressable>
                <Text style={styles.counterVal}>{counts[line.id] ?? 0}</Text>
                <Pressable
                  onPress={() => updateCount(line.id, (counts[line.id] ?? 0) + 1)}
                  style={styles.counterBtn}
                >
                  <Text style={styles.counterBtnText}>+</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
        <Text style={styles.total}>Total return items: {totalItems}</Text>
      </SectionCard>

      <PrimaryButton label="Confirm return" onPress={() => {}} />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  itemsWrap: {
    gap: Spacing.sm,
  },
  returnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  meta: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  sub: {
    marginTop: 4,
    fontSize: 12,
    color: Colors.textMuted,
  },
  counter: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 4,
  },
  counterBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  counterBtnText: {
    color: Colors.primaryBlue,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 20,
  },
  counterVal: {
    minWidth: 26,
    textAlign: "center",
    color: Colors.textPrimary,
    fontWeight: "700",
  },
  total: {
    marginTop: Spacing.sm,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
});
