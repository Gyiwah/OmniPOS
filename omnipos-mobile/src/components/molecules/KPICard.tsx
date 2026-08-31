import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Elevation } from "@/src/constants/elevation";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";

type KpiVariant = "primary" | "accent" | "success";

type KPICardProps = {
  title: string;
  value: string;
  period: string;
  variant?: KpiVariant;
};

const variantBg: Record<KpiVariant, string> = {
  primary: Colors.primaryBluePale,
  accent: Colors.accentOrangePale,
  success: "#dcfce7",
};

export function KPICard({ title, value, period, variant = "primary" }: KPICardProps) {
  return (
    <View style={[styles.wrap, { backgroundColor: variantBg[variant] }]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.period}>{period}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: Radius.card,
    padding: Spacing.md,
    gap: 4,
    ...Elevation.card,
  },
  title: { fontSize: 12, color: Colors.textSecondary, fontWeight: "600" },
  value: { fontSize: 22, fontWeight: "800", color: Colors.textPrimary },
  period: { fontSize: 11, color: Colors.textMuted },
});
