import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { Radius } from "@/src/constants/radius";
import { useAllSystemStores, usePlatformDashboard } from "@/src/features/superAdmin/hooks";
import { toErrorMessage } from "@/src/utils/errors";
import { useAuthStore } from "@/src/store/authStore";
import { authService } from "@/src/features/auth/service";
import { SYNC_STORAGE } from "@/src/sync/keys";

export default function SuperAdminDashboardScreen() {
  const router = useRouter();
  const { data: stores = [], isLoading, isError, error, refetch } = useAllSystemStores();
  const { data: dashboard } = usePlatformDashboard();

  function handleSignOut() {
    Alert.alert(
      "Sign Out of Platform?",
      "You will be signed out of the Super Admin Portal and returned to the login screen.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: async () => {
            try {
              await authService.signOut().catch(() => {});
              useAuthStore.getState().clearSession();
              await AsyncStorage.removeItem(SYNC_STORAGE.activeStoreId).catch(() => {});
              await AsyncStorage.removeItem("omnipos:cached_auth_session").catch(() => {});
              router.replace("/(auth)/sign-in");
            } catch (err) {
              Alert.alert("Sign Out Failed", toErrorMessage(err, "Could not sign out."));
            }
          },
        },
      ],
    );
  }

  const modules = [
    { label: "Stores", subtitle: "Tenants and lifecycle", icon: "business-outline" as const, route: "/super-admin/stores" },
    { label: "Branches", subtitle: "Parent store hierarchy", icon: "git-branch-outline" as const, route: "/super-admin/branches" },
    { label: "People", subtitle: "Users and platform access", icon: "people-outline" as const, route: "/super-admin/people" },
    { label: "Operations", subtitle: "Devices, sync, and audit", icon: "pulse-outline" as const, route: "/super-admin/operations" },
    { label: "Governance", subtitle: "Billing and catalogues", icon: "receipt-outline" as const, route: "/super-admin/governance" },
  ];

  return (
    <AppScrollScreen
      showBack
      onBack={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace("/(auth)/sign-in");
        }
      }}
      right={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          hitSlop={10}
          onPress={handleSignOut}
          style={styles.signOutHeaderBtn}
        >
          <Ionicons name="log-out-outline" size={22} color={Colors.danger} />
        </Pressable>
      }
      title="Super Admin Portal"
      subtitle="System-wide store provisioning and administrative management."
    >
      {/* Hero Provisioning Card */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.shieldIconWrap}>
            <Ionicons name="shield-checkmark" size={28} color={Colors.primaryBlue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Master Provisioning Engine</Text>
            <Text style={styles.heroSub}>
              Create new tenant stores and establish initial store administrator credentials.
            </Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.provisionBtn, pressed && { opacity: 0.9 }]}
          onPress={() => router.push("/super-admin/create-store")}
        >
          <Ionicons name="add-circle-outline" size={20} color={Colors.white} />
          <Text style={styles.provisionBtnText}>Provision Store & Admin Account</Text>
        </Pressable>
      </View>

      <View style={styles.metricsGrid}>
        <Metric label="Stores" value={dashboard?.stores.total ?? stores.length} detail={`${dashboard?.stores.active ?? 0} active`} icon="business-outline" />
        <Metric label="People" value={dashboard?.users.total ?? 0} detail={`${dashboard?.users.superAdmins ?? 0} platform admins`} icon="people-outline" />
        <Metric label="Devices" value={dashboard?.devices.total ?? 0} detail={`${dashboard?.devices.online ?? 0} online`} icon="phone-portrait-outline" />
        <Metric label="Sync queue" value={dashboard?.sync.pending ?? 0} detail={`${dashboard?.sync.failed ?? 0} failed`} icon="sync-outline" />
      </View>

      <SectionCard>
        <View style={styles.listHeader}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="grid-outline" size={20} color={Colors.primaryBlue} />
            <Text style={styles.sectionTitle}>Platform Modules</Text>
          </View>
        </View>
        <View style={styles.moduleGrid}>
          {modules.map((module) => (
            <Pressable key={module.route} style={({ pressed }) => [styles.moduleCard, pressed && { opacity: 0.8 }]} onPress={() => router.push(module.route as never)}>
              <Ionicons name={module.icon} size={22} color={Colors.primaryBlue} />
              <Text style={styles.moduleLabel}>{module.label}</Text>
              <Text style={styles.moduleSubtitle}>{module.subtitle}</Text>
            </Pressable>
          ))}
        </View>
      </SectionCard>

      {/* System Stores List */}
      <SectionCard>
        <View style={styles.listHeader}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="business-outline" size={20} color={Colors.primaryBlue} />
            <Text style={styles.sectionTitle}>System Stores ({stores.length})</Text>
          </View>
          <Pressable onPress={() => void refetch()} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="refresh-outline" size={20} color={Colors.primaryBlue} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={Colors.primaryBlue} />
            <Text style={styles.loadingText}>Fetching system stores...</Text>
          </View>
        ) : null}

        {isError ? (
          <Text style={styles.error}>{toErrorMessage(error, "Could not load system stores.")}</Text>
        ) : null}

        <View style={styles.storesList}>
          {stores.map((store) => (
            <View key={store.id} style={styles.storeCard}>
              <View style={styles.storeCardHeader}>
                <View style={styles.storeLeft}>
                  <View style={styles.storeIconWrap}>
                    <Ionicons name="storefront" size={20} color={Colors.primaryBlue} />
                  </View>
                  <View>
                    <Text style={styles.storeName}>{store.name}</Text>
                    <Text style={styles.storeId}>ID: {store.id.slice(0, 14)}...</Text>
                  </View>
                </View>

                <View style={styles.currencyBadge}>
                  <Text style={styles.currencyBadgeText}>{store.currency}</Text>
                </View>
              </View>

              <View style={styles.storeMetaGrid}>
                <View style={styles.metaRow}>
                  <Ionicons name="person-circle-outline" size={16} color={Colors.textMuted} />
                  <Text style={styles.metaLabel}>
                    Store Admin: <Text style={styles.metaBold}>{store.ownerName ?? "Assigned"}</Text>
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <Ionicons name="calendar-outline" size={16} color={Colors.textMuted} />
                  <Text style={styles.metaLabel}>
                    Created: {new Date(store.createdAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                  </Text>
                </View>
              </View>
            </View>
          ))}

          {!isLoading && stores.length === 0 ? (
            <Text style={styles.emptyNotice}>No tenant stores registered yet.</Text>
          ) : null}
        </View>
      </SectionCard>
    </AppScrollScreen>
  );
}

function Metric({ label, value, detail, icon }: { label: string; value: number; detail: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.metricCard}>
      <Ionicons name={icon} size={20} color={Colors.primaryBlue} />
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1.5,
    borderColor: "#bfdbfe",
    gap: Spacing.md,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  metricCard: {
    width: "48%",
    minHeight: 108,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.sm,
    gap: 3,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  metricLabel: { fontSize: 12, color: Colors.textMuted, fontWeight: "700" },
  metricValue: { fontSize: 25, color: Colors.textPrimary, fontWeight: "800" },
  metricDetail: { fontSize: 11, color: Colors.textMuted },
  moduleGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  moduleCard: {
    width: "48%",
    minHeight: 94,
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.input,
    padding: Spacing.sm,
    gap: 4,
  },
  moduleLabel: { fontSize: 14, fontWeight: "800", color: Colors.textPrimary },
  moduleSubtitle: { fontSize: 11, color: Colors.textMuted },
  heroHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  shieldIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
  heroSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  provisionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 14,
    borderRadius: Radius.pill,
  },
  provisionBtnText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: "800",
  },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.title,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  loadingBox: {
    paddingVertical: Spacing.md,
    alignItems: "center",
    gap: 6,
  },
  loadingText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  error: {
    color: Colors.danger,
    fontSize: 13,
    marginBottom: Spacing.xs,
  },
  storesList: {
    gap: Spacing.xs,
  },
  storeCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    gap: Spacing.xs,
  },
  storeCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  storeLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  storeIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  storeName: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  storeId: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  currencyBadge: {
    backgroundColor: Colors.background,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  currencyBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: Colors.textSecondary,
  },
  storeMetaGrid: {
    gap: 4,
    marginTop: Spacing.xs,
    paddingTop: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaLabel: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  metaBold: {
    color: Colors.textPrimary,
    fontWeight: "700",
  },
  emptyNotice: {
    textAlign: "center",
    color: Colors.textMuted,
    paddingVertical: Spacing.md,
  },
  signOutHeaderBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
  },
});
