import { Pressable, StyleSheet, Text } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Elevation } from "@/src/constants/elevation";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";

type PrinterStatusProps = {
  isConnected: boolean;
  macAddress?: string | null;
  onPress?: () => void;
};

export function PrinterStatus({ isConnected, macAddress, onPress }: PrinterStatusProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.card,
        {
          borderColor: isConnected ? Colors.primaryBlue : Colors.border,
        },
      ]}
    >
      <Text style={[styles.title, { color: isConnected ? Colors.primaryBlue : Colors.textMuted }]}>
        {isConnected ? "Printer connected" : "No printer paired"}
      </Text>
      {macAddress ? <Text style={styles.meta}>{macAddress}</Text> : null}
      <Text style={styles.hint}>{isConnected ? "Ready to print receipts" : "Tap to configure Bluetooth ESC/POS device"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1,
    backgroundColor: Colors.surface,
    ...Elevation.card,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
  },
  meta: {
    fontSize: 12,
    marginTop: 4,
    color: Colors.textSecondary,
  },
  hint: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 8,
  },
});
