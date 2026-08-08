import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { TextInput } from "@/src/components/atoms/TextInput";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
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

  async function handleProvision() {
    if (!storeName.trim()) {
      Alert.alert("Missing info", "Please enter a Store Name.");
      return;
    }
    if (!adminEmail.trim() || !adminEmail.includes("@")) {
      Alert.alert("Missing info", "Please enter a valid Store Admin email.");
      return;
    }
    if (!adminPassword || adminPassword.length < 6) {
      Alert.alert("Missing info", "Password must be at least 6 characters.");
      return;
    }

    try {
      await provisionStore.mutateAsync({
        storeName,
        currency,
        adminFullName,
        adminEmail,
        adminPassword,
      });

      Alert.alert(
        "Store Provisioned!",
        `Store "${storeName.trim()}" and Store Admin account (${adminEmail.trim()}) have been successfully created.`,
        [
          {
            text: "Done",
            onPress: () => router.back(),
          },
        ],
      );
    } catch (err) {
      Alert.alert("Provisioning Failed", toErrorMessage(err, "Could not create store."));
    }
  }

  return (
    <AppScrollScreen
      showBack
      title="Provision Store & Admin"
      subtitle="Set up a new store location and create its primary Store Admin credentials."
    >
      <SectionCard>
        <Text style={styles.sectionTitle}>Store Information</Text>
        <TextInput
          label="Store Name *"
          value={storeName}
          onChangeText={setStoreName}
          placeholder="e.g. Accra Main Branch"
        />

        <View style={styles.selectRow}>
          <Text style={styles.label}>Default Currency</Text>
          <Pressable
            style={styles.selectPill}
            onPress={() => {
              const currentIdx = CURRENCIES.indexOf(currency);
              const next = CURRENCIES[(currentIdx + 1) % CURRENCIES.length];
              setCurrency(next);
            }}
          >
            <Text style={styles.selectValue}>{currency}</Text>
            <Ionicons name="chevron-down" size={16} color={Colors.textMuted} />
          </Pressable>
        </View>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Store Admin Credentials</Text>
        <Text style={styles.helper}>
          This account will have full admin rights over this store to manage products, sales, branches, and staff.
        </Text>

        <TextInput
          label="Store Admin Full Name *"
          value={adminFullName}
          onChangeText={setAdminFullName}
          placeholder="e.g. John Doe"
        />
        <TextInput
          label="Store Admin Email *"
          value={adminEmail}
          onChangeText={setAdminEmail}
          placeholder="admin@store.com"
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          label="Store Admin Password *"
          value={adminPassword}
          onChangeText={setAdminPassword}
          placeholder="At least 6 characters"
          secureTextEntry
        />
      </SectionCard>

      <PrimaryButton
        label={provisionStore.isPending ? "Provisioning Store…" : "Provision Store & Admin"}
        disabled={provisionStore.isPending}
        onPress={() => void handleProvision()}
      />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  helper: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginBottom: Spacing.xs,
  },
  selectRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.xs,
  },
  label: {
    ...Typography.body,
    color: Colors.textPrimary,
    fontWeight: "600",
  },
  selectPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 7,
    minWidth: 100,
    justifyContent: "space-between",
  },
  selectValue: {
    color: Colors.textSecondary,
    fontWeight: "600",
  },
});
