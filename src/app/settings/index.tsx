import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/src/components/atoms/Avatar";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { useSettingsStore } from "@/src/store/settingsStore";

const MENU = [
  { label: "Store switching", route: "/settings/stores", icon: "business-outline" as const },
  { label: "Multi-user invites", route: "/settings/users", icon: "people-outline" as const },
  { label: "Printer", route: "/settings/printer", icon: "print-outline" as const },
  { label: "Backup + CSV export", route: "/settings/backup", icon: "cloud-upload-outline" as const },
];

export default function SettingsScreen() {
  const router = useRouter();
  const {
    shopName,
    shopEmail,
    shopLogoUri,
    language,
    currency,
    taxRate,
    vatRate,
    serviceRate,
    setShopProfile,
    setLanguage,
    setCurrency,
    setCharges,
  } = useSettingsStore();
  const [name, setName] = useState(shopName);
  const [email, setEmail] = useState(shopEmail);
  const [tax, setTax] = useState(String(taxRate));
  const [vat, setVat] = useState(String(vatRate));
  const [service, setService] = useState(String(serviceRate));

  async function pickLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      setShopProfile({ logoUri: result.assets[0]?.uri ?? null });
    }
  }

  function saveProfile() {
    setShopProfile({ name: name.trim() || shopName, email: email.trim() || shopEmail });
    setCharges({
      taxRate: Number(tax) || 0,
      vatRate: Number(vat) || 0,
      serviceRate: Number(service) || 0,
    });
    Alert.alert("Settings saved", "Shop profile and charge settings were updated.");
  }

  return (
    <AppScrollScreen showBack title="Settings" subtitle="Shop profile, language, currency, and charges setup.">
      <SectionCard>
        <Text style={styles.sectionTitle}>Shop branding</Text>
        <View style={styles.brandRow}>
          <Pressable onPress={() => void pickLogo()} hitSlop={10}>
            <Avatar uri={shopLogoUri} fallbackInitials={shopName} size={72} />
          </Pressable>
          <View style={{ flex: 1, gap: Spacing.xs }}>
            <TextInput label="Shop name" value={name} onChangeText={setName} placeholder="Shop name" />
            <TextInput label="Shop email" value={email} onChangeText={setEmail} placeholder="shop@email.com" />
          </View>
        </View>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Localization</Text>
        <View style={styles.selectRow}>
          <Text style={styles.label}>Language</Text>
          <Pressable
            style={styles.selectPill}
            onPress={() => setLanguage(language === "English" ? "French" : language === "French" ? "Spanish" : "English")}
          >
            <Text style={styles.selectValue}>{language}</Text>
            <Ionicons name="chevron-down" size={16} color={Colors.textMuted} />
          </Pressable>
        </View>
        <View style={styles.selectRow}>
          <Text style={styles.label}>Currency</Text>
          <Pressable
            style={styles.selectPill}
            onPress={() => setCurrency(currency === "GHS" ? "USD" : currency === "USD" ? "NGN" : "GHS")}
          >
            <Text style={styles.selectValue}>{currency}</Text>
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

      <PrimaryButton label="Save settings" onPress={saveProfile} />
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
});
