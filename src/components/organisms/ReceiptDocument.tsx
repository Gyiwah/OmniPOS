import { StyleSheet, Text, View } from "react-native";
import { AccentButton } from "@/src/components/atoms/AccentButton";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";

type ReceiptPayload = {
  orderNumber?: string;
  dateLabel?: string;
  totalsLine?: string;
};

type ReceiptDocumentProps = {
  order?: ReceiptPayload;
  store?: { name: string };
  onPrint?: () => void;
  onShare?: () => void;
};

export function ReceiptDocument({ order, store, onPrint, onShare }: ReceiptDocumentProps) {
  return (
    <View style={styles.sheet}>
      <Text style={styles.brand}>{store?.name ?? "OmniPOS"}</Text>
      <Text style={styles.meta}>Receipt · {order?.orderNumber ?? "—"}</Text>
      <Text style={styles.meta}>{order?.dateLabel ?? new Date().toLocaleString()}</Text>
      <View style={styles.block}>
        <Text style={styles.body}>{order?.totalsLine ?? "Subtotal · Tax · Total will render here"}</Text>
      </View>
      <PrimaryButton label="Print receipt" onPress={() => onPrint?.()} fullWidth variant="primary" />
      <AccentButton label="Share" onPress={() => onShare?.()} fullWidth outlined />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: Spacing.lg,
  },
  brand: {
    fontSize: 22,
    fontWeight: "800",
    color: Colors.textPrimary,
    textAlign: "center",
  },
  meta: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: "center",
  },
  block: {
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: Colors.textPrimary,
    fontVariant: ["tabular-nums"],
  },
});
