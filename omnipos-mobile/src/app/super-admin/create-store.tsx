import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { TextInput } from "@/src/components/atoms/TextInput";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { Radius } from "@/src/constants/radius";
import { usePlatformStores, useProvisionStoreWithAdmin } from "@/src/features/superAdmin/hooks";
import { toErrorMessage } from "@/src/utils/errors";
import { useStoreSlice } from "@/src/store/storeSlice";

const CURRENCIES = ["USD", "GHS", "NGN", "EUR", "GBP"] as const;
const TIMEZONES = [
  "UTC",
  "Africa/Accra",
  "Africa/Lagos",
  "Europe/London",
  "America/New_York",
] as const;

export default function SuperAdminCreateStoreScreen() {
  const router = useRouter();
  const provisionStore = useProvisionStoreWithAdmin();
  const { data: existingStores = [] } = usePlatformStores();

  const [storeName, setStoreName] = useState("");
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("USD");
  const [timezone, setTimezone] = useState<string>("UTC");
  const [parentStoreId, setParentStoreId] = useState<string | null>(null);

  const [adminFullName, setAdminFullName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [isExistingAccount, setIsExistingAccount] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Success Dialog State
  const [provisionedResult, setProvisionedResult] = useState<{
    store: { id: string; name: string };
    admin: { name: string; email: string };
  } | null>(null);

  async function handleProvision() {
    if (!storeName.trim()) {
      Alert.alert("Store Name Required", "Please enter a name for the new store.");
      return;
    }
    if (!adminEmail.trim() || !adminEmail.includes("@")) {
      Alert.alert("Admin Email Required", "Please enter a valid email address for the Store Admin.");
      return;
    }
    if (!isExistingAccount && (!adminPassword || adminPassword.length < 8)) {
      Alert.alert("Invalid Password", "Password must be at least 8 characters long.");
      return;
    }

    try {
      const res = await provisionStore.mutateAsync({
        storeName: storeName.trim(),
        currency,
        timezone,
        parentStoreId: parentStoreId || undefined,
        adminFullName: adminFullName.trim(),
        adminEmail: adminEmail.trim().toLowerCase(),
        adminPassword: isExistingAccount ? undefined : adminPassword,
      });

      const storeRes = res.store as { id?: string; name?: string } | undefined;
      const adminRes = res.storeAdmin as { fullName?: string; name?: string; email?: string } | undefined;

      setProvisionedResult({
        store: {
          id: String(storeRes?.id || ""),
          name: String(storeRes?.name || storeName.trim()),
        },
        admin: {
          name: String(adminRes?.fullName || adminRes?.name || adminFullName.trim()),
          email: String(adminRes?.email || adminEmail.trim()),
        },
      });
    } catch (err) {
      Alert.alert("Provisioning Error", toErrorMessage(err, "Could not create store."));
    }
  }

  return (
    <AppScrollScreen
      showBack
      title="Provision Store"
      subtitle="Establish a new tenant store, configure hierarchy, and assign its administrator."
    >
      {/* Store Information */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="business-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Store Tenant Profile</Text>
        </View>

        <TextInput
          label="Store / Business Name *"
          value={storeName}
          onChangeText={setStoreName}
          placeholder="e.g. Airport Hills Supermarket"
          leftIcon={<Ionicons name="storefront-outline" size={18} color={Colors.textMuted} />}
        />

        <View style={styles.settingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>Default Currency</Text>
            <Text style={styles.settingSub}>Transaction & reporting currency</Text>
          </View>
          <Pressable
            style={styles.currencyPill}
            onPress={() => {
              const currentIdx = CURRENCIES.indexOf(currency);
              const next = CURRENCIES[(currentIdx + 1) % CURRENCIES.length];
              setCurrency(next);
            }}
          >
            <Text style={styles.currencyValue}>{currency}</Text>
            <Ionicons name="swap-vertical" size={16} color={Colors.primaryBlue} />
          </Pressable>
        </View>

        <View style={styles.settingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>Store Timezone</Text>
            <Text style={styles.settingSub}>Daily reporting and shift cuts</Text>
          </View>
          <Pressable
            style={styles.currencyPill}
            onPress={() => {
              const currentIdx = TIMEZONES.indexOf(timezone as any);
              const next = TIMEZONES[(currentIdx + 1) % TIMEZONES.length];
              setTimezone(next);
            }}
          >
            <Text style={styles.currencyValue}>{timezone}</Text>
            <Ionicons name="swap-vertical" size={16} color={Colors.primaryBlue} />
          </Pressable>
        </View>

        {/* Parent Store Hierarchy Selection */}
        <View style={{ marginTop: Spacing.xs }}>
          <Text style={styles.settingLabel}>Store Type & Hierarchy</Text>
          <Text style={styles.settingSub}>Choose whether this is a standalone HQ or branch</Text>

          <View style={styles.parentChoices}>
            <Pressable
              style={[styles.parentChoice, !parentStoreId && styles.parentChoiceActive]}
              onPress={() => setParentStoreId(null)}
            >
              <Ionicons
                name="business"
                size={16}
                color={!parentStoreId ? Colors.primaryBlue : Colors.textMuted}
              />
              <Text style={[styles.parentChoiceText, !parentStoreId && styles.parentChoiceTextActive]}>
                Standalone Headquarters
              </Text>
            </Pressable>

            {existingStores
              .filter((s) => !s.parentStoreId)
              .map((store) => (
                <Pressable
                  key={store.id}
                  style={[styles.parentChoice, parentStoreId === store.id && styles.parentChoiceActive]}
                  onPress={() => setParentStoreId(store.id)}
                >
                  <Ionicons
                    name="git-branch-outline"
                    size={16}
                    color={parentStoreId === store.id ? Colors.primaryBlue : Colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.parentChoiceText,
                      parentStoreId === store.id && styles.parentChoiceTextActive,
                    ]}
                  >
                    Branch of {store.name}
                  </Text>
                </Pressable>
              ))}
          </View>
        </View>
      </SectionCard>

      {/* Admin Credentials */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="key-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Store Admin Credentials</Text>
        </View>
        <Text style={styles.helper}>
          This account will receive full administrative control over this store's inventory, staff, and sales records.
        </Text>

        <Pressable
          style={styles.toggleRow}
          onPress={() => setIsExistingAccount((v) => !v)}
        >
          <Ionicons
            name={isExistingAccount ? "checkbox" : "square-outline"}
            size={20}
            color={isExistingAccount ? Colors.primaryBlue : Colors.textMuted}
          />
          <Text style={styles.toggleText}>Assign to existing user account</Text>
        </Pressable>

        <TextInput
          label="Admin Full Name"
          value={adminFullName}
          onChangeText={setAdminFullName}
          placeholder="e.g. Elizabeth Cudjoe"
          leftIcon={<Ionicons name="person-outline" size={18} color={Colors.textMuted} />}
        />

        <TextInput
          label="Admin Login Email *"
          value={adminEmail}
          onChangeText={setAdminEmail}
          placeholder="admin@store.com"
          autoCapitalize="none"
          keyboardType="email-address"
          leftIcon={<Ionicons name="mail-outline" size={18} color={Colors.textMuted} />}
        />

        {!isExistingAccount ? (
          <TextInput
            label="Initial Password * (min 8 characters)"
            value={adminPassword}
            onChangeText={setAdminPassword}
            placeholder="At least 8 characters"
            secureTextEntry={!showPassword}
            leftIcon={<Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} />}
            rightIcon={
              <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10}>
                <Ionicons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color={Colors.textMuted}
                />
              </Pressable>
            }
          />
        ) : (
          <Text style={styles.existingNotice}>
            The user will retain their existing password to sign in to this store.
          </Text>
        )}
      </SectionCard>

      {/* Submit Action */}
      <View style={styles.actionWrap}>
        <Pressable
          style={({ pressed }) => [
            styles.submitBtn,
            provisionStore.isPending && { opacity: 0.6 },
            pressed && styles.submitBtnPressed,
          ]}
          disabled={provisionStore.isPending}
          onPress={() => void handleProvision()}
        >
          {provisionStore.isPending ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Ionicons name="shield-checkmark-outline" size={20} color={Colors.white} />
          )}
          <Text style={styles.submitBtnText}>
            {provisionStore.isPending ? "Provisioning Tenant..." : "Provision Store & Admin"}
          </Text>
        </Pressable>
      </View>

      {/* Provision Success Modal */}
      <Modal visible={Boolean(provisionedResult)} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={48} color="#059669" />
            </View>
            <Text style={styles.successTitle}>Store Provisioned!</Text>
            <Text style={styles.successBody}>
              Tenant store &quot;{provisionedResult?.store.name}&quot; has been created and linked to administrator{" "}
              {provisionedResult?.admin.email}.
            </Text>

            <View style={styles.modalButtons}>
              <Pressable
                style={styles.modalPrimaryBtn}
                onPress={() => {
                  if (provisionedResult) {
                    useStoreSlice.getState().setActiveStore(provisionedResult.store.id);
                  }
                  setProvisionedResult(null);
                  router.replace("/(tabs)/home");
                }}
              >
                <Ionicons name="storefront" size={18} color={Colors.white} />
                <Text style={styles.modalPrimaryText}>Enter Store POS</Text>
              </Pressable>

              <Pressable
                style={styles.modalSecondaryBtn}
                onPress={() => {
                  setProvisionedResult(null);
                  setStoreName("");
                  setAdminEmail("");
                  setAdminFullName("");
                  setAdminPassword("");
                }}
              >
                <Ionicons name="add" size={18} color={Colors.primaryBlue} />
                <Text style={styles.modalSecondaryText}>Provision Another Store</Text>
              </Pressable>

              <Pressable
                style={styles.modalTertiaryBtn}
                onPress={() => {
                  setProvisionedResult(null);
                  router.back();
                }}
              >
                <Text style={styles.modalTertiaryText}>Return to Portal</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.title,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  helper: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
    lineHeight: 16,
  },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.sm,
  },
  settingLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  settingSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  currencyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    backgroundColor: Colors.surface,
  },
  currencyValue: {
    color: Colors.primaryBlue,
    fontWeight: "800",
    fontSize: 12,
  },
  parentChoices: {
    gap: 6,
    marginTop: Spacing.xs,
  },
  parentChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: Radius.input,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: Colors.surface,
  },
  parentChoiceActive: {
    borderColor: Colors.primaryBlue,
    backgroundColor: Colors.primaryBluePale,
  },
  parentChoiceText: {
    fontSize: 12,
    color: Colors.textPrimary,
    fontWeight: "600",
  },
  parentChoiceTextActive: {
    color: Colors.primaryBlue,
    fontWeight: "800",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: Spacing.sm,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  existingNotice: {
    fontSize: 12,
    color: Colors.textMuted,
    fontStyle: "italic",
    paddingVertical: 6,
  },
  actionWrap: {
    marginTop: Spacing.xs,
    marginBottom: Spacing.xl,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 15,
    borderRadius: Radius.pill,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  submitBtnText: {
    color: Colors.white,
    fontWeight: "800",
    fontSize: 14,
  },
  // Success Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.xl,
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    gap: Spacing.sm,
  },
  successIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#ecfdf5",
    alignItems: "center",
    justifyContent: "center",
  },
  successTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  successBody: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: Spacing.sm,
  },
  modalButtons: {
    width: "100%",
    gap: 8,
  },
  modalPrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.primaryBlue,
    borderRadius: Radius.pill,
    paddingVertical: 13,
  },
  modalPrimaryText: {
    color: Colors.white,
    fontWeight: "800",
    fontSize: 13,
  },
  modalSecondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.pill,
    paddingVertical: 13,
  },
  modalSecondaryText: {
    color: Colors.primaryBlue,
    fontWeight: "800",
    fontSize: 13,
  },
  modalTertiaryBtn: {
    alignItems: "center",
    paddingVertical: 10,
  },
  modalTertiaryText: {
    color: Colors.textMuted,
    fontWeight: "700",
    fontSize: 13,
  },
});
