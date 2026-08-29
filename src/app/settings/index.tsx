import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/src/components/atoms/Avatar";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { authService } from "@/src/features/auth/service";
import { useSaveStoreSettings, useStoreSettings } from "@/src/features/settings/hooks";
import { isLocalImageUri, resolveStoreLogoUrl } from "@/src/services/storage";
import { SYNC_STORAGE } from "@/src/sync/keys";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useAuthStore } from "@/src/store/authStore";
import { useStoreSlice } from "@/src/store/storeSlice";
import { toErrorMessage } from "@/src/utils/errors";

const MENU = [
  { label: "Store switching", route: "/settings/stores", icon: "business-outline" as const },
  { label: "Multi-user invites", route: "/settings/users", icon: "people-outline" as const },
  { label: "Printer", route: "/settings/printer", icon: "print-outline" as const },
  { label: "Backup + CSV export", route: "/settings/backup", icon: "cloud-upload-outline" as const },
];

const LANGUAGES = ["English", "French", "Spanish"] as const;
const CURRENCIES = ["GHS", "USD", "NGN"] as const;

export default function SettingsScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);
  const { shopName, shopEmail, shopLogoUri, language, currency, taxRate, vatRate, serviceRate, hydrateFromServer } =
    useSettingsStore();
  const { data: remoteSettings, isLoading, isError, error } = useStoreSettings();
  const saveSettings = useSaveStoreSettings();

  const [name, setName] = useState(shopName);
  const [email, setEmail] = useState(shopEmail);
  const [tax, setTax] = useState(String(taxRate));
  const [vat, setVat] = useState(String(vatRate));
  const [service, setService] = useState(String(serviceRate));
  const [localLanguage, setLocalLanguage] = useState(language);
  const [localCurrency, setLocalCurrency] = useState(currency);
  const [logoUri, setLogoUri] = useState<string | null>(shopLogoUri);
  const [pendingLogoUri, setPendingLogoUri] = useState<string | null>(null);

  useEffect(() => {
    if (!remoteSettings) return;

    async function applyRemote() {
      if (!remoteSettings) return;
      const resolvedLogo = remoteSettings.logoUrl ? await resolveStoreLogoUrl(remoteSettings.logoUrl) : null;

      hydrateFromServer({
        shopName: remoteSettings.name,
        shopEmail: remoteSettings.email ?? "",
        shopLogoUri: resolvedLogo,
        language: remoteSettings.language,
        currency: remoteSettings.currency,
        appModeDark: remoteSettings.appModeDark,
        taxRate: remoteSettings.taxRate,
        vatRate: remoteSettings.vatRate,
        serviceRate: remoteSettings.serviceRate,
      });

      setName(remoteSettings.name);
      setEmail(remoteSettings.email ?? "");
      setTax(String(remoteSettings.taxRate));
      setVat(String(remoteSettings.vatRate));
      setService(String(remoteSettings.serviceRate));
      setLocalLanguage(remoteSettings.language);
      setLocalCurrency(remoteSettings.currency);
      setLogoUri(resolvedLogo);
      setPendingLogoUri(null);
    }

    void applyRemote();
  }, [remoteSettings, hydrateFromServer]);

  async function pickLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      const uri = result.assets[0]?.uri ?? null;
      setLogoUri(uri);
      setPendingLogoUri(uri);
    }
  }

  async function saveProfile() {
    if (!activeStoreId) {
      Alert.alert("No store selected", "Choose an active store before saving settings.");
      return;
    }

    try {
      await saveSettings.mutateAsync({
        name: name.trim() || shopName,
        email: email.trim() || null,
        language: localLanguage,
        currency: localCurrency,
        taxRate: Number(tax) || 0,
        vatRate: Number(vat) || 0,
        serviceRate: Number(service) || 0,
        localLogoUri: pendingLogoUri && isLocalImageUri(pendingLogoUri) ? pendingLogoUri : undefined,
      });
      Alert.alert("Settings saved", "Shop profile and charge settings were synced to your store.");
    } catch (err) {
      Alert.alert("Save failed", toErrorMessage(err, "Could not update store settings."));
    }
  }

  async function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure you want to sign out of OmniPOS?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          try {
            await authService.signOut();
            useAuthStore.getState().clearSession();
            useStoreSlice.getState().setActiveStore(null);
            await AsyncStorage.removeItem(SYNC_STORAGE.activeStoreId);
            router.replace("/(auth)/sign-in");
          } catch (err) {
            Alert.alert("Sign Out Error", toErrorMessage(err, "Failed to sign out."));
          }
        },
      },
    ]);
  }

  if (!activeStoreId) {
    return (
      <AppScrollScreen showBack title="Settings" subtitle="Select a store to manage settings.">
        <SectionCard>
          <Text style={styles.helper}>No active store. Complete onboarding or switch stores first.</Text>
          <PrimaryButton label="Manage stores" onPress={() => router.push("/settings/stores")} />
        </SectionCard>
        <PrimaryButton
          label="Sign Out"
          variant="outline"
          style={styles.signOutBtn}
          onPress={() => void handleSignOut()}
        />
      </AppScrollScreen>
    );
  }

  return (
    <AppScrollScreen showBack title="Settings" subtitle="Shop profile, language, currency, and charges setup.">
      {isLoading ? (
        <SectionCard>
          <ActivityIndicator color={Colors.primaryBlue} />
          <Text style={styles.helper}>Loading store settings…</Text>
        </SectionCard>
      ) : null}

      {isError ? (
        <SectionCard>
          <Text style={styles.error}>{toErrorMessage(error, "Could not load store settings.")}</Text>
        </SectionCard>
      ) : null}

      {isSuperAdmin ? (
        <SectionCard>
          <Pressable
            onPress={() => router.push("/super-admin" as never)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: Colors.primaryBluePale,
              padding: Spacing.sm,
              borderRadius: Radius.input,
              borderWidth: 1,
              borderColor: Colors.primaryBlue,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm, flex: 1 }}>
              <Ionicons name="shield-checkmark" size={24} color={Colors.primaryBlue} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...Typography.title, color: Colors.primaryBlue, fontSize: 16 }}>Super Admin Portal</Text>
                <Text style={{ ...Typography.caption, color: Colors.textSecondary }}>Provision system stores & store admin credentials</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.primaryBlue} />
          </Pressable>
        </SectionCard>
      ) : null}

      <SectionCard>
        <Text style={styles.sectionTitle}>Shop branding</Text>
        <View style={styles.brandRow}>
          <Pressable onPress={() => void pickLogo()} hitSlop={10}>
            <Avatar uri={logoUri} fallbackInitials={name || shopName} size={64} />
          </Pressable>
          <View style={{ flex: 1, gap: Spacing.xs }}>
            <TextInput label="Shop name" value={name} onChangeText={setName} placeholder="e.g. Osu Branch" />
          </View>
        </View>
        <TextInput label="Shop email" value={email} onChangeText={setEmail} placeholder="shop@email.com" autoCapitalize="none" keyboardType="email-address" />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Localization</Text>
        <View style={styles.selectRow}>
          <Text style={styles.label}>Language</Text>
          <Pressable
            style={styles.selectPill}
            onPress={() => {
              const current = LANGUAGES.indexOf(localLanguage as (typeof LANGUAGES)[number]);
              const next = LANGUAGES[(current + 1 + LANGUAGES.length) % LANGUAGES.length];
              setLocalLanguage(next);
            }}
          >
            <Text style={styles.selectValue}>{localLanguage}</Text>
            <Ionicons name="chevron-down" size={16} color={Colors.textMuted} />
          </Pressable>
        </View>
        <View style={styles.selectRow}>
          <Text style={styles.label}>Currency</Text>
          <Pressable
            style={styles.selectPill}
            onPress={() => {
              const current = CURRENCIES.indexOf(localCurrency as (typeof CURRENCIES)[number]);
              const next = CURRENCIES[(current + 1 + CURRENCIES.length) % CURRENCIES.length];
              setLocalCurrency(next);
            }}
          >
            <Text style={styles.selectValue}>{localCurrency}</Text>
            <Ionicons name="chevron-down" size={16} color={Colors.textMuted} />
          </Pressable>
        </View>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Other charges (sales/receipt)</Text>
        <TextInput label="Tax %" value={tax} onChangeText={setTax} keyboardType="decimal-pad" />
        <TextInput label="VAT %" value={vat} onChangeText={setVat} keyboardType="decimal-pad" />
        <TextInput label="Service charge %" value={service} onChangeText={setService} keyboardType="decimal-pad" />
      </SectionCard>

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

      <PrimaryButton
        label={saveSettings.isPending ? "Saving…" : "Save settings"}
        disabled={saveSettings.isPending}
        onPress={() => void saveProfile()}
      />

      <View style={styles.signOutWrapper}>
        <Pressable
          style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutButtonPressed]}
          onPress={() => void handleSignOut()}
        >
          <Ionicons name="log-out-outline" size={20} color={Colors.accentOrange} />
          <Text style={styles.signOutText}>Sign Out of OmniPOS</Text>
        </Pressable>
      </View>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  selectRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.sm,
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
    minWidth: 120,
    justifyContent: "space-between",
  },
  selectValue: {
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  menu: { gap: Spacing.sm },
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
  rowLeft: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  rowLabel: { ...Typography.body, color: Colors.textPrimary, fontWeight: "700" },
  helper: {
    ...Typography.caption,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: Spacing.xs,
  },
  error: {
    ...Typography.body,
    color: Colors.accentOrange,
  },
  signOutWrapper: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
  },
  signOutButtonPressed: {
    backgroundColor: "#fee2e2",
    transform: [{ scale: 0.99 }],
  },
  signOutText: {
    ...Typography.body,
    color: Colors.danger,
    fontWeight: "700",
    fontSize: 15,
  },
  signOutBtn: {
    marginTop: Spacing.md,
    borderColor: "#fecaca",
  },
});
