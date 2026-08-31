import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/src/components/atoms/Avatar";
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
  { label: "Switch & Manage Stores", subtitle: "Manage multi-store locations", route: "/settings/stores", icon: "business-outline" as const },
  { label: "Team & Staff Access", subtitle: "Invite cashiers and store admins", route: "/settings/users", icon: "people-outline" as const },
  { label: "Thermal Receipt Printer", subtitle: "Configure ESC/POS & Bluetooth", route: "/settings/printer", icon: "print-outline" as const },
  { label: "Backup & CSV Export", subtitle: "Export sales and product reports", route: "/settings/backup", icon: "cloud-upload-outline" as const },
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
      Alert.alert("Settings Saved", "Store profile, charges, and localization settings were synced.");
    } catch (err) {
      Alert.alert("Save Failed", toErrorMessage(err, "Could not update store settings."));
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
            await AsyncStorage.removeItem(SYNC_STORAGE.activeStoreId);
            await AsyncStorage.removeItem("omnipos:cached_auth_session");
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
          <Pressable style={styles.manageStoresBtn} onPress={() => router.push("/settings/stores")}>
            <Ionicons name="business" size={18} color={Colors.white} />
            <Text style={styles.manageStoresBtnText}>Manage Stores</Text>
          </Pressable>
        </SectionCard>
        <View style={styles.signOutWrapper}>
          <Pressable style={styles.signOutButton} onPress={() => void handleSignOut()}>
            <Ionicons name="log-out-outline" size={20} color={Colors.danger} />
            <Text style={styles.signOutText}>Sign Out of OmniPOS</Text>
          </Pressable>
        </View>
      </AppScrollScreen>
    );
  }

  return (
    <AppScrollScreen
      showBack
      title="Store Settings"
      subtitle="Branding, tax rates, localization, and system preferences."
    >
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

      {/* Super Admin Portal Banner */}
      {isSuperAdmin ? (
        <Pressable
          onPress={() => router.push("/super-admin" as never)}
          style={({ pressed }) => [styles.superAdminBanner, pressed && { opacity: 0.9 }]}
        >
          <View style={styles.superAdminLeft}>
            <View style={styles.shieldIconWrap}>
              <Ionicons name="shield-checkmark" size={24} color={Colors.primaryBlue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.superAdminTitle}>Super Admin Portal</Text>
              <Text style={styles.superAdminSub}>Provision stores & manage system-wide administrators</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.primaryBlue} />
        </Pressable>
      ) : null}

      {/* Store Identity & Branding Card */}
      <SectionCard>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="storefront-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Store Identity & Branding</Text>
        </View>

        <View style={styles.brandRow}>
          <Pressable onPress={() => void pickLogo()} hitSlop={10} style={styles.avatarContainer}>
            <Avatar uri={logoUri} fallbackInitials={name || shopName} size={68} />
            <View style={styles.cameraBadge}>
              <Ionicons name="camera" size={14} color={Colors.white} />
            </View>
          </Pressable>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.brandHintTitle}>Store Logo & Identity</Text>
            <Text style={styles.brandHintSubtitle}>Tap the avatar to upload an image from your device photo library.</Text>
          </View>
        </View>

        <View style={{ marginTop: Spacing.sm, gap: Spacing.xs }}>
          <TextInput
            label="Store / Branch Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Accra Central Branch"
            leftIcon={<Ionicons name="business-outline" size={18} color={Colors.textMuted} />}
          />
          <TextInput
            label="Store Contact Email"
            value={email}
            onChangeText={setEmail}
            placeholder="store@email.com"
            autoCapitalize="none"
            keyboardType="email-address"
            leftIcon={<Ionicons name="mail-outline" size={18} color={Colors.textMuted} />}
          />
        </View>
      </SectionCard>

      {/* Quick Navigation Menu Groups */}
      <SectionCard>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="options-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Store Management</Text>
        </View>

        <View style={styles.menuList}>
          {MENU.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => router.push(item.route as never)}
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
            >
              <View style={styles.menuRowLeft}>
                <View style={styles.menuIconWrap}>
                  <Ionicons name={item.icon} size={20} color={Colors.primaryBlue} />
                </View>
                <View>
                  <Text style={styles.menuRowTitle}>{item.label}</Text>
                  <Text style={styles.menuRowSub}>{item.subtitle}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </Pressable>
          ))}
        </View>
      </SectionCard>

      {/* Localization & Region */}
      <SectionCard>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="globe-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Localization & Currency</Text>
        </View>

        <View style={styles.selectRow}>
          <View>
            <Text style={styles.selectLabel}>Display Language</Text>
            <Text style={styles.selectSub}>POS interface language</Text>
          </View>
          <Pressable
            style={styles.selectPill}
            onPress={() => {
              const current = LANGUAGES.indexOf(localLanguage as (typeof LANGUAGES)[number]);
              const next = LANGUAGES[(current + 1 + LANGUAGES.length) % LANGUAGES.length];
              setLocalLanguage(next);
            }}
          >
            <Text style={styles.selectValue}>{localLanguage}</Text>
            <Ionicons name="swap-vertical" size={16} color={Colors.primaryBlue} />
          </Pressable>
        </View>

        <View style={[styles.selectRow, { marginTop: Spacing.sm }]}>
          <View>
            <Text style={styles.selectLabel}>Primary Currency</Text>
            <Text style={styles.selectSub}>Used across orders & receipts</Text>
          </View>
          <Pressable
            style={styles.selectPill}
            onPress={() => {
              const current = CURRENCIES.indexOf(localCurrency as (typeof CURRENCIES)[number]);
              const next = CURRENCIES[(current + 1 + CURRENCIES.length) % CURRENCIES.length];
              setLocalCurrency(next);
            }}
          >
            <Text style={styles.selectValue}>{localCurrency}</Text>
            <Ionicons name="swap-vertical" size={16} color={Colors.primaryBlue} />
          </Pressable>
        </View>
      </SectionCard>

      {/* Rates, VAT & Service Charges */}
      <SectionCard>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="calculator-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Taxes & Charges (Applied at Checkout)</Text>
        </View>

        <View style={styles.chargesGrid}>
          <View style={styles.chargeFieldWrap}>
            <TextInput
              label="Standard Tax %"
              value={tax}
              onChangeText={setTax}
              placeholder="0"
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.chargeFieldWrap}>
            <TextInput
              label="VAT %"
              value={vat}
              onChangeText={setVat}
              placeholder="0"
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        <View style={{ marginTop: Spacing.xs }}>
          <TextInput
            label="Service Charge %"
            value={service}
            onChangeText={setService}
            placeholder="0"
            keyboardType="decimal-pad"
          />
        </View>
      </SectionCard>

      {/* Save Settings Primary Button */}
      <Pressable
        style={({ pressed }) => [
          styles.saveButton,
          saveSettings.isPending && styles.saveButtonDisabled,
          pressed && styles.saveButtonPressed,
        ]}
        disabled={saveSettings.isPending}
        onPress={() => void saveProfile()}
      >
        {saveSettings.isPending ? (
          <ActivityIndicator size="small" color={Colors.white} />
        ) : (
          <Ionicons name="cloud-done-outline" size={20} color={Colors.white} />
        )}
        <Text style={styles.saveButtonText}>
          {saveSettings.isPending ? "Syncing Settings..." : "Save Settings"}
        </Text>
      </Pressable>

      {/* Sign Out Button */}
      <View style={styles.signOutWrapper}>
        <Pressable
          style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutButtonPressed]}
          onPress={() => void handleSignOut()}
        >
          <Ionicons name="log-out-outline" size={20} color={Colors.danger} />
          <Text style={styles.signOutText}>Sign Out of OmniPOS</Text>
        </Pressable>
      </View>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  cardHeaderRow: {
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
  superAdminBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.primaryBluePale,
    padding: Spacing.md,
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderColor: Colors.primaryBlue,
  },
  superAdminLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  shieldIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  superAdminTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
  superAdminSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  avatarContainer: {
    position: "relative",
  },
  cameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: Colors.primaryBlue,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  brandHintTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  brandHintSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  menuList: {
    gap: Spacing.xs,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.sm + 2,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  menuRowPressed: {
    backgroundColor: "#f8fafc",
  },
  menuRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  menuIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  menuRowTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  menuRowSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  selectRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  selectLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  selectSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  selectPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
  },
  selectValue: {
    color: Colors.primaryBlue,
    fontWeight: "800",
    fontSize: 13,
  },
  chargesGrid: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  chargeFieldWrap: {
    flex: 1,
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 16,
    borderRadius: Radius.pill,
    marginTop: Spacing.xs,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: "800",
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
    color: Colors.danger,
    fontWeight: "800",
    fontSize: 14,
  },
  manageStoresBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 12,
    borderRadius: Radius.pill,
    marginTop: Spacing.sm,
  },
  manageStoresBtnText: {
    color: Colors.white,
    fontWeight: "700",
  },
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
});
