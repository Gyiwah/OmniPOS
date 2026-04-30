import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { StoreSwitcher } from "@/src/components/molecules/StoreSwitcher";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { SYNC_STORAGE } from "@/src/sync/keys";
import { useStoreSlice } from "@/src/store/storeSlice";

type StoreRow = { id: string; name: string };

const INITIAL_STORES: StoreRow[] = [
  { id: "store-1", name: "Northside Market" },
  { id: "store-2", name: "Airport Kiosk" },
  { id: "store-3", name: "East Legon Shop" },
];

export default function SettingsStoresScreen() {
  const globalActiveStore = useStoreSlice((s) => s.activeStoreId);
  const setActiveStore = useStoreSlice((s) => s.setActiveStore);
  const [stores, setStores] = useState<StoreRow[]>(INITIAL_STORES);
  const [activeId, setActiveId] = useState<string | null>(globalActiveStore ?? INITIAL_STORES[0]?.id ?? null);
  const [name, setName] = useState("");

  async function applyStoreSwitch() {
    if (!activeId) return;
    setActiveStore(activeId);
    await AsyncStorage.setItem(SYNC_STORAGE.activeStoreId, activeId);
    Alert.alert("Store switched", "Active store updated for sales, sync, and inventory views.");
  }

  function addStore() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = `store-${stores.length + 1}`;
    setStores((prev) => [...prev, { id, name: trimmed }]);
    setName("");
    setActiveId(id);
  }

  return (
    <AppScrollScreen showBack title="Stores" subtitle="Switch active location and manage store list.">
      <SectionCard>
        <Text style={styles.sectionTitle}>Active store</Text>
        <StoreSwitcher stores={stores} activeId={activeId} onSwitch={setActiveId} />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Add store</Text>
        <TextInput label="Store name" value={name} onChangeText={setName} placeholder="e.g. Circle Branch" />
        <PrimaryButton label="Add store to list" variant="outline" onPress={addStore} />
      </SectionCard>

      <PrimaryButton label="Apply store switch" onPress={() => void applyStoreSwitch()} />
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
  },
});
