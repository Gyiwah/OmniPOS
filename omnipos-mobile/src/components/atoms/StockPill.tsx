import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";

type StockPillProps = {
  count: number;
  threshold: number;
};

export function StockPill({ count, threshold }: StockPillProps) {
  const low = count <= threshold;
  return (
    <View style={[styles.pill, { backgroundColor: low ? Colors.accentOrangePale : Colors.primaryBluePale }]}>
      <Text style={[styles.text, { color: low ? Colors.accentOrange : Colors.primaryBlue }]}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    minWidth: 28,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.badge,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 12,
    fontWeight: "700",
  },
});
