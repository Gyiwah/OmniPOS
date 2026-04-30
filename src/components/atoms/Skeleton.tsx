import { StyleSheet, View, ViewStyle } from "react-native";
import { Colors } from "@/src/constants/colors";

type SkeletonProps = {
  width: number | `${number}%`;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
};

export function Skeleton({ width, height, borderRadius = 8, style }: SkeletonProps) {
  return <View style={[styles.box, { width, height, borderRadius }, style]} />;
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: Colors.divider,
    opacity: 0.9,
  },
});
