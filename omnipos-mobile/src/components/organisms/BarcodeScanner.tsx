import { CameraView, type BarcodeScanningResult, useCameraPermissions } from "expo-camera";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";

import { playScannerBeep } from "@/src/utils/scannerAudio";

/** Stage-1 scaffold: swaps to react-native-vision-camera + barcode plugin in POS build */
type BarcodeScannerProps = {
  label?: string;
  flashEnabled?: boolean;
  onScan: (payload: string) => void;
};

export function BarcodeScanner({ label = "Align barcode inside frame", flashEnabled, onScan }: BarcodeScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

  function handleScanned(result: BarcodeScanningResult) {
    if (locked) return;
    const payload = result.data?.trim();
    if (!payload) return;
    setLocked(true);
    void playScannerBeep();
    onScan(payload);
  }

  if (!permission?.granted) {
    return (
      <View style={styles.panel}>
        <Text style={styles.caption}>Camera permission is required for barcode scanning.</Text>
        <PrimaryButton label="Allow camera access" variant="outline" onPress={() => void requestPermission()} />
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.frame}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={Boolean(flashEnabled)}
          barcodeScannerSettings={{
            barcodeTypes: [
              "ean13",
              "ean8",
              "upc_a",
              "upc_e",
              "code39",
              "code93",
              "code128",
              "itf14",
              "codabar",
              "qr",
            ],
          }}
          onBarcodeScanned={handleScanned}
        />
        <View style={[styles.edge, styles.tl]} />
        <View style={[styles.edge, styles.tr]} />
        <View style={[styles.edge, styles.bl]} />
        <View style={[styles.edge, styles.br]} />
      </View>
      <Text style={styles.caption}>{label}</Text>
      {locked ? (
        <Pressable style={styles.resetPill} onPress={() => setLocked(false)}>
          <Text style={styles.resetLabel}>Scan again</Text>
        </Pressable>
      ) : null}
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
    overflow: "hidden",
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
  resetPill: {
    alignSelf: "center",
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  resetLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
});
