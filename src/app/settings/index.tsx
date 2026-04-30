import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

const MENU = [
  { label: "Stores", route: "/settings/stores", icon: "business-outline" as const },
  { label: "Users & Roles", route: "/settings/users", icon: "people-outline" as const },
  { label: "Printer", route: "/settings/printer", icon: "print-outline" as const },
  { label: "Backup & Restore", route: "/settings/backup", icon: "cloud-upload-outline" as const },
];

export default function SettingsScreen() {
  const router = useRouter();

  return (
    <AppScrollScreen title="Settings" subtitle="Manage store preferences, team access, printer, and backups.">
      <SectionCard>
        <View style={styles.menu}>
          {MENU.map((item) => (
            <Pressable key={item.label} onPress={() => router.push(item.route as never)} style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name={item.icon} size={18} color={Colors.primaryBlue} />
                <Text style={styles.rowLabel}>{item.label}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </Pressable>
          ))}
        </View>
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  menu: {
    gap: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  rowLabel: {
    ...Typography.body,
    color: Colors.textPrimary,
    fontWeight: "600",
  },
});
