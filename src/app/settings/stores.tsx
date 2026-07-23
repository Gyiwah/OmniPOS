import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { StoreSwitcher } from "@/src/components/molecules/StoreSwitcher";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { useCreateStore, useStores } from "@/src/features/stores/hooks";
import { SYNC_STORAGE } from "@/src/sync/keys";
import { useStoreSlice } from "@/src/store/storeSlice";
import { toErrorMessage } from "@/src/utils/errors";

export default function SettingsStoresScreen() {
  const globalActiveStore = useStoreSlice((s) => s.activeStoreId);
  const setActiveStore = useStoreSlice((s) => s.setActiveStore);
  const { data: stores = [], isLoading, isError, error, refetch } = useStores();
  const createStore = useCreateStore();

  const [activeId, setActiveId] = useState<string | null>(globalActiveStore);
  const [name, setName] = useState("");

  useEffect(() => {
    if (globalActiveStore) {
      setActiveId(globalActiveStore);
      return;
    }
    if (stores.length > 0 && !activeId) {
      setActiveId(stores[0].id);
    }
  }, [globalActiveStore, stores, activeId]);

  async function applyStoreSwitch() {
    if (!activeId) return;
    setActiveStore(activeId);
    await AsyncStorage.setItem(SYNC_STORAGE.activeStoreId, activeId);
    Alert.alert("Store switched", "Active store updated for sales, sync, and inventory views.");
  }

  async function addStore() {
    const trimmed = name.trim();
    if (!trimmed) return;

    try {
      const created = await createStore.mutateAsync(trimmed);
      setName("");
      setActiveId(created.id);
      await refetch();
      Alert.alert("Store added", `${created.name} is ready. Apply the switch to activate it.`);
    } catch (err) {
      Alert.alert("Could not add store", toErrorMessage(err, "Store creation failed."));
    }
  }

  return (
    <AppScrollScreen showBack title="Stores" subtitle="Switch active location and manage store list.">
      <SectionCard>
        <Text style={styles.sectionTitle}>Active store</Text>
        {isLoading ? <ActivityIndicator color={Colors.primaryBlue} /> : null}
        {isError ? <Text style={styles.error}>{toErrorMessage(error, "Failed to load stores.")}</Text> : null}
        {!isLoading && stores.length === 0 ? (
          <Text style={styles.helper}>No stores found for this account yet.</Text>
        ) : (
          <StoreSwitcher stores={stores} activeId={activeId} onSwitch={setActiveId} />
        )}
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Add store</Text>
        <TextInput label="Store name" value={name} onChangeText={setName} placeholder="e.g. Circle Branch" />
        <PrimaryButton
          label={createStore.isPending ? "Adding…" : "Add store to list"}
          variant="outline"
          disabled={createStore.isPending}
          onPress={() => void addStore()}
        />
      </SectionCard>

      <PrimaryButton label="Apply store switch" disabled={!activeId} onPress={() => void applyStoreSwitch()} />
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
  error: {
    ...Typography.body,
    color: Colors.accentOrange,
    marginBottom: Spacing.xs,
  },
});
