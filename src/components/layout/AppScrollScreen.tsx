import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
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
  left?: ReactNode;
  showBack?: boolean;
  fixedHeader?: boolean;
  children: ReactNode;
};

export function AppScrollScreen({
  title,
  subtitle,
  right,
  left,
  showBack,
  fixedHeader = true,
  children,
}: AppScrollScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const header = (
    <View style={[styles.headerRow, fixedHeader && styles.fixedHeader]}>
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
      ) : (
        left ?? null
      )}
      <View style={styles.titleBlock}>
        <Text style={styles.title}>{title}</Text>
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {fixedHeader ? header : null}
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          fixedHeader && styles.scrollBelowFixedHeader,
          { paddingBottom: Math.max(insets.bottom, Spacing.md) + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {fixedHeader ? null : header}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function SectionCard({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.section, style]}>{children}</View>;
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
  scrollBelowFixedHeader: {
    paddingTop: Spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  fixedHeader: {
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.divider,
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
