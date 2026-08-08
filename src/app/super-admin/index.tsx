import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { Radius } from "@/src/constants/radius";
import { useAllSystemStores } from "@/src/features/superAdmin/hooks";
import { toErrorMessage } from "@/src/utils/errors";

export default function SuperAdminDashboardScreen() {
  const router = useRouter();
  const { data: stores = [], isLoading, isError, error, refetch } = useAllSystemStores();

  return (
    <AppScrollScreen
      showBack
      title="Super Admin Portal"
      subtitle="System-wide store provisioning and store admin overview."
    >
      <SectionCard>
        <View style={styles.headerCardInner}>
          <View style={styles.headerRow}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.cardTitle}>Store Provisioning</Text>
              <Text style={styles.cardSub}>Create stores and assign initial Store Admin login credentials.</Text>
            </View>
            <Ionicons name="shield-checkmark" size={32} color={Colors.primaryBlue} />
          </View>
          <PrimaryButton
            label="Provision New Store & Admin"
            onPress={() => router.push("/super-admin/create-store")}
          />
        </View>
      </SectionCard>

      <SectionCard>
        <View style={styles.titleRow}>
          <Text style={styles.sectionTitle}>System Stores ({stores.length})</Text>
          <Pressable onPress={() => void refetch()} hitSlop={10}>
            <Ionicons name="refresh-outline" size={20} color={Colors.primaryBlue} />
          </Pressable>
        </View>

        {isLoading ? <ActivityIndicator color={Colors.primaryBlue} style={{ marginVertical: Spacing.md }} /> : null}

        {isError ? (
          <Text style={styles.error}>{toErrorMessage(error, "Could not load system stores.")}</Text>
        ) : null}

        {!isLoading && stores.length === 0 ? (
          <Text style={styles.helper}>No stores provisioned yet. Use the button above to create one.</Text>
        ) : (
          <View style={styles.list}>
            {stores.map((store) => (
              <View key={store.id} style={styles.storeItem}>
                <View style={styles.storeTopRow}>
                  <Text style={styles.storeName}>{store.name}</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{store.currency}</Text>
                  </View>
                </View>
                <View style={styles.detailRow}>
                  <Ionicons name="person-circle-outline" size={16} color={Colors.textMuted} />
                  <Text style={styles.detailText}>
                    Store Admin: <Text style={styles.detailBold}>{store.ownerName ?? "Assigned"}</Text>
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Ionicons name="calendar-outline" size={16} color={Colors.textMuted} />
                  <Text style={styles.detailText}>
                    Created: {new Date(store.createdAt).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  headerCardInner: {
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.input,
    padding: Spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  headerTextWrap: {
    flex: 1,
    paddingRight: Spacing.sm,
  },
  cardTitle: {
    ...Typography.title,
    color: Colors.primaryBlue,
    marginBottom: 2,
  },
  cardSub: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
  },
  list: {
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  storeItem: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    gap: 6,
  },
  storeTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  storeName: {
    ...Typography.body,
    fontWeight: "700",
    color: Colors.textPrimary,
    fontSize: 16,
  },
  badge: {
    backgroundColor: Colors.border,
    paddingHorizontal: Spacing.xs + 4,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  badgeText: {
    ...Typography.caption,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  detailText: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  detailBold: {
    color: Colors.textPrimary,
    fontWeight: "600",
  },
  helper: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },
  error: {
    ...Typography.body,
    color: Colors.accentOrange,
    marginTop: Spacing.xs,
  },
});
