import { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Elevation } from "@/src/constants/elevation";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";

type AnalyticsCardProps = PropsWithChildren<{
  title: string;
  period: string;
  averageLabel?: ReactNode;
  todayLabel?: ReactNode;
}>;

export function AnalyticsCard({ title, period, averageLabel, todayLabel, children }: AnalyticsCardProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.period}>{period}</Text>
        </View>
        {todayLabel}
        {averageLabel}
      </View>
      <View>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Elevation.card,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  title: { fontSize: 18, fontWeight: "700", color: Colors.textPrimary },
  period: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
});
