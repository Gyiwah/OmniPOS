import { useState } from "react";
import { StyleSheet, Text } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { StoreSwitcher } from "@/src/components/molecules/StoreSwitcher";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

const STORES = [
  { id: "store-1", name: "Northside Market" },
  { id: "store-2", name: "Airport Kiosk" },
  { id: "store-3", name: "East Legon Shop" },
];

export default function SettingsStoresScreen() {
  const [activeId, setActiveId] = useState<string | null>("store-1");
  const [name, setName] = useState("");

  return (
    <AppScrollScreen showBack title="Stores" subtitle="Switch active location and manage store details.">
      <SectionCard>
        <Text style={styles.sectionTitle}>Active store</Text>
        <StoreSwitcher stores={STORES} activeId={activeId} onSwitch={setActiveId} />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Add store</Text>
        <TextInput label="Store name" value={name} onChangeText={setName} placeholder="e.g. Circle Branch" />
      </SectionCard>

      <PrimaryButton label="Save store changes" onPress={() => {}} />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
});
