import { ReactNode } from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";

type ScreenPlaceholderProps = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
};

export function ScreenPlaceholder({ title, subtitle, right }: ScreenPlaceholderProps) {
  return (
    <SafeAreaView style={styles.root}>
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
    padding: Spacing.lg,
  },
  card: {
    borderRadius: 20,
    backgroundColor: Colors.white,
    padding: Spacing.xl,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    gap: Spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.md,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: Colors.secondary,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.mutedText,
  },
});
