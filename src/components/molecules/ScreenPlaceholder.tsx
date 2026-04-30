import { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Colors } from "@/src/constants/colors";
import { Elevation } from "@/src/constants/elevation";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

type ScreenPlaceholderProps = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
};

export function ScreenPlaceholder({ title, subtitle, right }: ScreenPlaceholderProps) {
  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{title}</Text>
          {right}
        </View>
        <Text style={styles.subtitle}>
          {subtitle ?? "Scaffold ready. Implement feature module and wire data hooks next."}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.md,
  },
  card: {
    borderRadius: Radius.card,
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Elevation.card,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.md,
  },
  title: {
    ...Typography.headline,
    color: Colors.textPrimary,
  },
  subtitle: {
    ...Typography.body,
    lineHeight: 22,
    color: Colors.textSecondary,
  },
});
