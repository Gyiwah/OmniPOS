import { StyleSheet, View } from "react-native";
import { Colors } from "@/src/constants/colors";

type DividerProps = {
  marginVertical?: number;
};

export function Divider({ marginVertical = 0 }: DividerProps) {
  return <View style={[styles.line, { marginVertical }]} />;
}

const styles = StyleSheet.create({
  line: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    width: "100%",
  },
});
