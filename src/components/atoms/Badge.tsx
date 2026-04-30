import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";

type BadgeProps = {
  count: number;
  color?: string;
  backgroundColor?: string;
};

export function Badge({ count, color = Colors.textWhite, backgroundColor = Colors.danger }: BadgeProps) {
  if (count <= 0) return null;
  return (
    <View style={[styles.dot, { backgroundColor }]}>
      <Text style={[styles.text, { color }]}>{count > 99 ? "99+" : String(count)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    minWidth: 18,
    height: 18,
    borderRadius: Radius.badge,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 10,
    fontWeight: "700",
  },
});
