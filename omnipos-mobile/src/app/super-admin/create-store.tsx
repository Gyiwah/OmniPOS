import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { TextInput } from "@/src/components/atoms/TextInput";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { Radius } from "@/src/constants/radius";
import { useProvisionStoreWithAdmin } from "@/src/features/superAdmin/hooks";
import { toErrorMessage } from "@/src/utils/errors";

const CURRENCIES = ["USD", "GHS", "NGN", "EUR", "GBP"] as const;

export default function SuperAdminCreateStoreScreen() {
  const router = useRouter();
  const provisionStore = useProvisionStoreWithAdmin();

  const [storeName, setStoreName] = useState("");
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("USD");
  const [adminFullName, setAdminFullName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function handleProvision() {
    if (!storeName.trim()) {
      Alert.alert("Store Name Required", "Please enter a name for the new store.");
      return;
    }
    if (!adminEmail.trim() || !adminEmail.includes("@")) {
      Alert.alert("Admin Email Required", "Please enter a valid email address for the Store Admin.");
      return;
    }
    if (!adminPassword || adminPassword.length < 6) {
      Alert.alert("Invalid Password", "Password must be at least 6 characters.");
      return;
    }

    try {
      await provisionStore.mutateAsync({
        storeName: storeName.trim(),
        currency,
        adminFullName: adminFullName.trim(),
        adminEmail: adminEmail.trim().toLowerCase(),
        adminPassword,
      });

      Alert.alert(
        "Store Provisioned!",
        `Store "${storeName.trim()}" and Store Admin account (${adminEmail.trim()}) have been successfully created.`,
        [
          {
            text: "Return to Portal",
            onPress: () => router.back(),
          },
        ],
      );
    } catch (err) {
      Alert.alert("Provisioning Error", toErrorMessage(err, "Could not create store."));
    }
  }

  return (
    <AppScrollScreen
      showBack
      title="Provision Store"
      subtitle="Establish a new store tenant and assign its primary Store Admin."
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

        <View style={styles.currencyRow}>
          <View>
            <Text style={styles.currencyLabel}>Default Currency</Text>
            <Text style={styles.currencySub}>Transaction & reporting currency</Text>
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
      </SectionCard>

      {/* Admin Credentials */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="key-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Store Admin Credentials</Text>
        </View>
        <Text style={styles.helper}>
          This user will receive full administrative control over this store's inventory, staff, and sales records.
        </Text>

        <TextInput
          label="Admin Full Name *"
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

        <TextInput
          label="Initial Password *"
          value={adminPassword}
          onChangeText={setAdminPassword}
          placeholder="At least 6 characters"
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
  currencyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.sm,
  },
  currencyLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  currencySub: {
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
    paddingVertical: 8,
    backgroundColor: Colors.surface,
  },
  currencyValue: {
    color: Colors.primaryBlue,
    fontWeight: "800",
    fontSize: 13,
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
    paddingVertical: 16,
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
    fontSize: 16,
    fontWeight: "800",
  },
});
