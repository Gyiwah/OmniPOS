import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Elevation } from "@/src/constants/elevation";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";

type OrderCardProps = {
  thumbnails?: (string | null)[];
  customerName?: string | null;
  dateLabel: string;
  itemCount: number;
  totalLabel: string;
  isPartPayment?: boolean;
  onPress?: () => void;
};

export function OrderCard({
  thumbnails = [],
  customerName,
  dateLabel,
  itemCount,
  totalLabel,
  isPartPayment,
  onPress,
}: OrderCardProps) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.wrap, pressed && { opacity: 0.96 }]}>
        <View style={styles.row}>
          {thumbnails.slice(0, 3).map((uri, idx) =>
            uri ? (
              // eslint-disable-next-line react/no-array-index-key — stable enough for thumbnail strip preview
              <Image key={`${idx}`} source={{ uri }} style={styles.thumb} />
            ) : (
              <View key={idx} style={[styles.thumb, styles.placeholder]} />
            ),
          )}
        </View>
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>
            {customerName?.trim() || "Walk-in customer"}
          </Text>
          <Text style={styles.sub}>
            {dateLabel} · {itemCount} items
            {isPartPayment ? " · Part payment" : ""}
          </Text>
        </View>
        <Text style={[styles.total, isPartPayment && { color: Colors.accentOrange }]}>{totalLabel}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Elevation.card,
  },
  row: { flexDirection: "row", gap: 4 },
  thumb: { width: 36, height: 36, borderRadius: 8 },
  placeholder: { backgroundColor: Colors.divider },
  meta: { flex: 1 },
  title: { fontSize: 15, fontWeight: "600", color: Colors.textPrimary },
  sub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  total: { fontSize: 16, fontWeight: "800", color: Colors.primaryBlue },
});
