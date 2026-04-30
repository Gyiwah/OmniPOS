import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";

/** Stage-1 scaffold: swaps to react-native-vision-camera + barcode plugin in POS build */
type BarcodeScannerProps = {
  label?: string;
  flashEnabled?: boolean;
  onScan: (payload: string) => void;
};

export function BarcodeScanner({ label = "Align barcode inside frame", flashEnabled, onScan }: BarcodeScannerProps) {
  void flashEnabled;
  void onScan;
  return (
    <View style={styles.panel}>
      <View style={styles.frame}>
        <View style={[styles.edge, styles.tl]} />
        <View style={[styles.edge, styles.tr]} />
        <View style={[styles.edge, styles.bl]} />
        <View style={[styles.edge, styles.br]} />
      </View>
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

const edgeSize = 24;
const edgeThick = 3;

const styles = StyleSheet.create({
  panel: {
    backgroundColor: Colors.navyDark,
    padding: Spacing.md,
    borderRadius: Radius.card,
    gap: Spacing.sm,
  },
  frame: {
    aspectRatio: 4 / 3,
    borderRadius: Radius.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  edge: {
    position: "absolute",
    width: edgeSize,
    height: edgeSize,
    borderColor: Colors.primaryBlueLight,
  },
  tl: {
    top: 12,
    left: 12,
    borderTopWidth: edgeThick,
    borderLeftWidth: edgeThick,
    borderTopLeftRadius: Radius.input,
  },
  tr: {
    top: 12,
    right: 12,
    borderTopWidth: edgeThick,
    borderRightWidth: edgeThick,
    borderTopRightRadius: Radius.input,
  },
  bl: {
    bottom: 12,
    left: 12,
    borderBottomWidth: edgeThick,
    borderLeftWidth: edgeThick,
    borderBottomLeftRadius: Radius.input,
  },
  br: {
    bottom: 12,
    right: 12,
    borderBottomWidth: edgeThick,
    borderRightWidth: edgeThick,
    borderBottomRightRadius: Radius.input,
  },
  caption: {
    color: Colors.textWhite,
    textAlign: "center",
    fontSize: 13,
    opacity: 0.82,
  },
});
