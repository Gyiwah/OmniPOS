import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { useCreateStore, useStores } from "@/src/features/stores/hooks";
import { SYNC_STORAGE } from "@/src/sync/keys";
import { useStoreSlice } from "@/src/store/storeSlice";
import { toErrorMessage } from "@/src/utils/errors";

export default function SettingsStoresScreen() {
  const globalActiveStore = useStoreSlice((s) => s.activeStoreId);
  const setActiveStore = useStoreSlice((s) => s.setActiveStore);
  const queryClient = useQueryClient();
  const { data: stores = [], isLoading, isError, error, refetch } = useStores();
  const createStore = useCreateStore();

  const [activeId, setActiveId] = useState<string | null>(globalActiveStore);
  const [name, setName] = useState("");

  useEffect(() => {
    if (!activeId) {
      if (globalActiveStore) {
        setActiveId(globalActiveStore);
      } else if (stores.length > 0) {
        setActiveId(stores[0].id);
      }
    }
  }, [globalActiveStore, stores]);

  async function applyStoreSwitch(targetId?: string) {
    const selectedId = targetId ?? activeId;
    if (!selectedId) return;

    setActiveId(selectedId);
    setActiveStore(selectedId);
    await AsyncStorage.setItem(SYNC_STORAGE.activeStoreId, selectedId);
    await queryClient.invalidateQueries();

    const selectedStore = stores.find((s) => s.id === selectedId);
    const storeName = selectedStore?.name ?? "Selected store";
    Alert.alert("Store Activated", `"${storeName}" is now the active location for orders, catalog, and inventory sync.`);
  }

  async function addStore() {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert("Name Required", "Please enter a valid store branch name.");
      return;
    }

    try {
      const created = await createStore.mutateAsync(trimmed);
      setName("");
      await refetch();
      await applyStoreSwitch(created.id);
    } catch (err) {
      Alert.alert("Store Creation Failed", toErrorMessage(err, "Could not add store location."));
    }
  }

  return (
    <AppScrollScreen
      showBack
      title="Store Locations"
      subtitle="Switch between branches or provision a new store location."
    >
      {/* Active & Available Stores List */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="business-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Available Stores ({stores.length})</Text>
        </View>

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={Colors.primaryBlue} />
            <Text style={styles.loadingText}>Loading store locations...</Text>
          </View>
        ) : null}

        {isError ? <Text style={styles.error}>{toErrorMessage(error, "Failed to load store list.")}</Text> : null}

        <View style={styles.storeList}>
          {stores.map((s) => {
            const isCurrentlyActive = s.id === globalActiveStore;
            const isSelected = s.id === activeId;
            return (
              <Pressable
                key={s.id}
                style={({ pressed }) => [
                  styles.storeCard,
                  isSelected && styles.storeCardSelected,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => setActiveId(s.id)}
              >
                <View style={styles.storeLeft}>
                  <View style={[styles.storeIconWrap, isCurrentlyActive && styles.storeIconWrapActive]}>
                    <Ionicons
                      name="storefront"
                      size={20}
                      color={isCurrentlyActive ? Colors.white : Colors.primaryBlue}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.storeName}>{s.name}</Text>
                    <Text style={styles.storeId}>ID: {s.id.slice(0, 12)}...</Text>
                  </View>
                </View>

                {isCurrentlyActive ? (
                  <View style={styles.activeBadge}>
                    <Ionicons name="checkmark-circle" size={14} color="#16a34a" />
                    <Text style={styles.activeBadgeText}>Active Now</Text>
                  </View>
                ) : (
                  <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                    {isSelected ? <View style={styles.radioInner} /> : null}
                  </View>
                )}
              </Pressable>
            );
          })}

          {!isLoading && stores.length === 0 ? (
            <Text style={styles.emptyNotice}>No store branches registered yet.</Text>
          ) : null}
        </View>
      </SectionCard>

      {/* Switch Action */}
      {activeId && activeId !== globalActiveStore ? (
        <View style={{ marginBottom: Spacing.sm }}>
          <Pressable
            style={({ pressed }) => [styles.switchBtn, pressed && { opacity: 0.9 }]}
            onPress={() => void applyStoreSwitch()}
          >
            <Ionicons name="swap-horizontal" size={20} color={Colors.white} />
            <Text style={styles.switchBtnText}>Switch to Selected Store</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Add New Branch Card */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="add-circle-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Add New Branch Location</Text>
        </View>

        <TextInput
          label="Branch / Store Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Tema Mall Branch"
          leftIcon={<Ionicons name="business-outline" size={18} color={Colors.textMuted} />}
        />

        <Pressable
          style={({ pressed }) => [
            styles.addBtn,
            createStore.isPending && { opacity: 0.6 },
            pressed && { opacity: 0.9 },
          ]}
          disabled={createStore.isPending}
          onPress={() => void addStore()}
        >
          {createStore.isPending ? (
            <ActivityIndicator size="small" color={Colors.primaryBlue} />
          ) : (
            <Ionicons name="add" size={18} color={Colors.primaryBlue} />
          )}
          <Text style={styles.addBtnText}>
            {createStore.isPending ? "Creating Location..." : "Create & Activate Store"}
          </Text>
        </Pressable>
      </SectionCard>
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
  loadingBox: {
    paddingVertical: Spacing.md,
    alignItems: "center",
    gap: 6,
  },
  loadingText: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  error: {
    color: Colors.danger,
    fontSize: 13,
    marginBottom: Spacing.xs,
  },
  storeList: {
    gap: Spacing.xs,
  },
  storeCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.sm + 2,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
  },
  storeCardSelected: {
    borderColor: Colors.primaryBlue,
    backgroundColor: Colors.primaryBluePale,
  },
  storeLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  storeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  storeIconWrapActive: {
    backgroundColor: "#16a34a",
  },
  storeName: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  storeId: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#dcfce7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  activeBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#15803d",
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioCircleSelected: {
    borderColor: Colors.primaryBlue,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primaryBlue,
  },
  emptyNotice: {
    textAlign: "center",
    color: Colors.textMuted,
    paddingVertical: Spacing.md,
  },
  switchBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 14,
    borderRadius: Radius.pill,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  switchBtnText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: "800",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: Colors.primaryBlue,
    marginTop: Spacing.sm,
  },
  addBtnText: {
    color: Colors.primaryBlue,
    fontSize: 14,
    fontWeight: "700",
  },
});
