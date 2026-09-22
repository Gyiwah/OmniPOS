import Ionicons from "@expo/vector-icons/Ionicons";
import { usePathname, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";

export const SUPER_ADMIN_NAV_ITEMS = [
  { label: "Dashboard", route: "/super-admin", icon: "speedometer-outline" as const },
  { label: "Stores", route: "/super-admin/stores", icon: "business-outline" as const },
  { label: "Branches", route: "/super-admin/branches", icon: "git-branch-outline" as const },
  { label: "People", route: "/super-admin/people", icon: "people-outline" as const },
  { label: "Operations", route: "/super-admin/operations", icon: "pulse-outline" as const },
  { label: "Governance", route: "/super-admin/governance", icon: "receipt-outline" as const },
] as const;

export function SuperAdminNavBar() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {SUPER_ADMIN_NAV_ITEMS.map((item) => {
          const isActive =
            item.route === "/super-admin"
              ? pathname === "/super-admin"
              : pathname.startsWith(item.route);

          return (
            <Pressable
              key={item.route}
              onPress={() => {
                if (!isActive) {
                  router.push(item.route as never);
                }
              }}
              style={({ pressed }) => [
                styles.navPill,
                isActive && styles.navPillActive,
                pressed && { opacity: 0.8 },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={16}
                color={isActive ? Colors.white : Colors.textSecondary}
              />
              <Text style={[styles.navText, isActive && styles.navTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    marginBottom: Spacing.sm,
  },
  scrollContent: {
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  navPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  navPillActive: {
    backgroundColor: Colors.primaryBlue,
    borderColor: Colors.primaryBlue,
  },
  navText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  navTextActive: {
    color: Colors.white,
    fontWeight: "800",
  },
});
