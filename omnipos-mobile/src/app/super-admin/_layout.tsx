import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { useAuthStore } from "@/src/store/authStore";
import { authService } from "@/src/features/auth/service";

export default function SuperAdminLayout() {
  const router = useRouter();
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);

  if (!isSuperAdmin) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.deniedCard}>
          <View style={styles.iconCircle}>
            <Ionicons name="shield" size={42} color={Colors.danger} />
          </View>
          <Text style={styles.title}>Platform Access Restricted</Text>
          <Text style={styles.subtitle}>
            This area is restricted to OmniPOS platform administrators. Your account does not have Super Admin privileges.
          </Text>

          <View style={styles.buttonStack}>
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.9 }]}
              onPress={() => router.replace("/(tabs)/home")}
            >
              <Ionicons name="storefront-outline" size={18} color={Colors.white} />
              <Text style={styles.primaryButtonText}>Return to POS</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.8 }]}
              onPress={async () => {
                await authService.signOut().catch(() => {});
                useAuthStore.getState().clearSession();
                router.replace("/(auth)/sign-in");
              }}
            >
              <Ionicons name="log-out-outline" size={18} color={Colors.textSecondary} />
              <Text style={styles.secondaryButtonText}>Sign In as Different User</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  deniedCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.xl,
    alignItems: "center",
    width: "100%",
    maxWidth: 380,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: Colors.textPrimary,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 19,
    marginBottom: Spacing.xl,
  },
  buttonStack: {
    width: "100%",
    gap: Spacing.sm,
  },
  primaryButton: {
    backgroundColor: Colors.primaryBlue,
    borderRadius: Radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryButtonText: {
    color: Colors.white,
    fontWeight: "800",
    fontSize: 14,
  },
  secondaryButton: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: Radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  secondaryButtonText: {
    color: Colors.textSecondary,
    fontWeight: "700",
    fontSize: 14,
  },
});
