import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/src/constants/colors";
import { Elevation } from "@/src/constants/elevation";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

type AppScrollScreenProps = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  showBack?: boolean;
  children: ReactNode;
};

export function AppScrollScreen({ title, subtitle, right, showBack, children }: AppScrollScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, Spacing.md) + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          {showBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={() => router.back()}
              style={styles.backBtn}
              hitSlop={10}
            >
              <Ionicons name="chevron-back" size={24} color={Colors.primaryBlue} />
            </Pressable>
          ) : null}
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {right ? <View style={styles.right}>{right}</View> : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function SectionCard({ children }: { children: ReactNode }) {
  return <View style={styles.section}>{children}</View>;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  backBtn: {
    marginTop: 2,
    padding: Spacing.xs,
  },
  titleBlock: {
    flex: 1,
    gap: Spacing.xs,
  },
  title: {
    ...Typography.headline,
    color: Colors.textPrimary,
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  right: {
    marginLeft: "auto",
    alignSelf: "center",
  },
  section: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Elevation.card,
  },
});
