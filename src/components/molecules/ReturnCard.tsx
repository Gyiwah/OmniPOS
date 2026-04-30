import { Pressable, StyleSheet, Text } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Elevation } from "@/src/constants/elevation";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";

type ReturnCardProps = {
  thumbnail?: string | null;
  dateLabel: string;
  itemCount: number;
  totalRefundLabel: string;
  onPress?: () => void;
};

export function ReturnCard({ thumbnail, dateLabel, itemCount, totalRefundLabel, onPress }: ReturnCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.wrap,
        { backgroundColor: Colors.accentOrangePale },
        pressed && { opacity: 0.96 },
      ]}
    >
      <Text style={styles.summary}>
        Refund · {thumbnail ? "SKU" : "#"} · {dateLabel}
      </Text>
      <Text style={styles.detail}>
        Items {itemCount} · Total{" "}
        <Text style={styles.amount}>{totalRefundLabel}</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: Radius.card,
    padding: Spacing.md,
    gap: Spacing.xs,
    ...Elevation.card,
  },
  summary: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  detail: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  amount: {
    color: Colors.accentOrange,
    fontWeight: "800",
  },
});
