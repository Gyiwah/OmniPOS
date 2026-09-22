import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { TextInput as CustomTextInput } from "@/src/components/atoms/TextInput";
import { SuperAdminNavBar } from "@/src/components/superAdmin/SuperAdminNavBar";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import {
  useDeleteStore,
  usePlatformStores,
  useStoreMembers,
  useUpdateStore,
  useUpdateStoreStatus,
} from "@/src/features/superAdmin/hooks";
import type { PlatformStore, UpdateStoreInput } from "@/src/features/superAdmin/types";
import { toErrorMessage } from "@/src/utils/errors";
import { useStoreSlice } from "@/src/store/storeSlice";

const STATUS_COLORS: Record<PlatformStore["status"], string> = {
  active: "#059669",
  suspended: "#d97706",
  inactive: "#64748b",
};

const CURRENCIES = ["USD", "GHS", "NGN", "EUR", "GBP"] as const;

export default function SuperAdminStoresScreen() {
  const router = useRouter();
  const { data: stores = [], isLoading, isError, error, refetch } = usePlatformStores();
  const updateStoreMutation = useUpdateStore();
  const updateStatusMutation = useUpdateStoreStatus();
  const deleteStoreMutation = useDeleteStore();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PlatformStore["status"]>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Edit Modal State
  const [editingStore, setEditingStore] = useState<PlatformStore | null>(null);
  const [editForm, setEditForm] = useState<UpdateStoreInput>({});

  // Members Sheet State
  const [inspectingStore, setInspectingStore] = useState<PlatformStore | null>(null);
  const membersQuery = useStoreMembers(inspectingStore?.id ?? null);

  const filteredStores = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return stores.filter((store) => {
      const matchesFilter = statusFilter === "all" || store.status === statusFilter;
      const matchesQuery =
        !needle ||
        store.name.toLowerCase().includes(needle) ||
        (store.ownerName ?? "").toLowerCase().includes(needle) ||
        (store.ownerEmail ?? "").toLowerCase().includes(needle) ||
        store.currency.toLowerCase().includes(needle);
      return matchesFilter && matchesQuery;
    });
  }, [stores, query, statusFilter]);

  async function handleToggleStatus(store: PlatformStore) {
    const nextStatus = store.status === "active" ? "suspended" : "active";
    setBusyId(store.id);
    try {
      await updateStatusMutation.mutateAsync({ storeId: store.id, status: nextStatus });
    } catch (err) {
      Alert.alert("Status Change Failed", toErrorMessage(err, "Could not update store status."));
    } finally {
      setBusyId(null);
    }
  }

  function handleOpenEdit(store: PlatformStore) {
    setEditingStore(store);
    setEditForm({
      name: store.name,
      currency: store.currency,
      timezone: store.timezone,
      taxProfile: store.taxProfile,
      status: store.status,
    });
  }

  async function handleSaveEdit() {
    if (!editingStore || !editForm.name?.trim()) {
      Alert.alert("Store Name Required", "Please enter a valid store name.");
      return;
    }
    setBusyId(editingStore.id);
    try {
      await updateStoreMutation.mutateAsync({
        storeId: editingStore.id,
        input: {
          name: editForm.name.trim(),
          currency: editForm.currency,
          timezone: editForm.timezone,
          taxProfile: editForm.taxProfile,
          status: editForm.status,
        },
      });
      setEditingStore(null);
      Alert.alert("Store Updated", `"${editForm.name.trim()}" has been updated successfully.`);
    } catch (err) {
      Alert.alert("Update Failed", toErrorMessage(err, "Could not update store."));
    } finally {
      setBusyId(null);
    }
  }

  function handleSwitchStore(store: PlatformStore) {
    Alert.alert(
      "Switch Active Store?",
      `Do you want to switch your active app session to "${store.name}" and enter its POS till?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Switch to Store",
          onPress: () => {
            useStoreSlice.getState().setActiveStore(store.id);
            router.replace("/(tabs)/home");
          },
        },
      ],
    );
  }

  function confirmDelete(store: PlatformStore) {
    Alert.alert(
      "WARNING: Delete Store?",
      `Are you sure you want to permanently delete "${store.name}"? This action will remove all store records and cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Permanently Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusyId(store.id);
              try {
                await deleteStoreMutation.mutateAsync(store.id);
                Alert.alert("Store Deleted", `Store "${store.name}" was removed from the platform.`);
              } catch (err) {
                Alert.alert("Delete Failed", toErrorMessage(err, "Could not delete store."));
              } finally {
                setBusyId(null);
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <AppScrollScreen
      showBack
      title="Store Tenants"
      subtitle="Lifecycle, ownership, and multi-tenant estate management."
      onRefresh={() => void refetch()}
    >
      <SuperAdminNavBar />

      {/* Search & Filter Toolbar */}
      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search stores, owner, currency..."
            placeholderTextColor={Colors.textMuted}
            style={styles.searchInput}
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={10}>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterPills}>
          {(["all", "active", "suspended", "inactive"] as const).map((filter) => (
            <Pressable
              key={filter}
              onPress={() => setStatusFilter(filter)}
              style={[styles.filterPill, statusFilter === filter && styles.filterPillActive]}
            >
              <Text style={[styles.filterPillText, statusFilter === filter && styles.filterPillTextActive]}>
                {filter.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Stores List */}
      <SectionCard>
        <View style={styles.header}>
          <Text style={styles.heading}>
            Stores ({filteredStores.length} of {stores.length})
          </Text>
          <Pressable onPress={() => void refetch()} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="refresh-outline" size={20} color={Colors.primaryBlue} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={Colors.primaryBlue} />
            <Text style={styles.loadingText}>Loading platform stores...</Text>
          </View>
        ) : null}

        {isError ? <Text style={styles.error}>{toErrorMessage(error, "Could not load stores.")}</Text> : null}

        {filteredStores.map((store) => (
          <View key={store.id} style={styles.storeCard}>
            <View style={styles.storeTop}>
              <View style={styles.iconWrap}>
                <Ionicons name="storefront-outline" size={20} color={Colors.primaryBlue} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Text style={styles.storeName}>{store.name}</Text>
                  {store.parentStoreId ? (
                    <View style={styles.branchTag}>
                      <Text style={styles.branchTagText}>BRANCH</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.muted}>
                  Owner: {store.ownerName || "Unassigned"} {store.ownerEmail ? `(${store.ownerEmail})` : ""}
                </Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: `${STATUS_COLORS[store.status]}15` }]}>
                <Text style={[styles.status, { color: STATUS_COLORS[store.status] }]}>
                  {store.status.toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaBadge}>{store.currency}</Text>
              <Text style={styles.metaBadge}>{store.timezone}</Text>
              <Text style={styles.metaDetail}>{store.membersCount} staff members</Text>
              <Text style={styles.metaDetail}>{store.ordersCount} orders</Text>
            </View>

            {/* Action Buttons */}
            <View style={styles.actions}>
              <Pressable
                style={styles.switchButton}
                disabled={busyId === store.id}
                onPress={() => handleSwitchStore(store)}
              >
                <Ionicons name="swap-horizontal" size={15} color={Colors.white} />
                <Text style={styles.switchText}>Switch To</Text>
              </Pressable>

              <Pressable
                style={styles.actionButton}
                disabled={busyId === store.id}
                onPress={() => handleOpenEdit(store)}
              >
                <Ionicons name="pencil-outline" size={15} color={Colors.primaryBlue} />
                <Text style={styles.actionText}>Edit</Text>
              </Pressable>

              <Pressable
                style={styles.actionButton}
                disabled={busyId === store.id}
                onPress={() => setInspectingStore(store)}
              >
                <Ionicons name="people-outline" size={15} color={Colors.primaryBlue} />
                <Text style={styles.actionText}>Members</Text>
              </Pressable>

              <Pressable
                style={styles.actionButton}
                disabled={busyId === store.id}
                onPress={() => void handleToggleStatus(store)}
              >
                <Ionicons
                  name={store.status === "active" ? "pause-outline" : "play-outline"}
                  size={15}
                  color={Colors.primaryBlue}
                />
                <Text style={styles.actionText}>{store.status === "active" ? "Suspend" : "Activate"}</Text>
              </Pressable>

              <Pressable
                style={styles.deleteButton}
                disabled={busyId === store.id}
                onPress={() => confirmDelete(store)}
              >
                <Ionicons name="trash-outline" size={15} color={Colors.danger} />
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>
          </View>
        ))}

        {!isLoading && filteredStores.length === 0 ? (
          <Text style={styles.empty}>No stores match your search or filter.</Text>
        ) : null}
      </SectionCard>

      {/* Edit Store Modal */}
      <Modal visible={Boolean(editingStore)} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="business-outline" size={20} color={Colors.primaryBlue} />
                <Text style={styles.modalTitle}>Edit Store</Text>
              </View>
              <Pressable onPress={() => setEditingStore(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ gap: Spacing.sm }}>
              <CustomTextInput
                label="Store Name *"
                value={editForm.name ?? ""}
                onChangeText={(text) => setEditForm((prev) => ({ ...prev, name: text }))}
                placeholder="Business Name"
              />

              <CustomTextInput
                label="Timezone"
                value={editForm.timezone ?? ""}
                onChangeText={(text) => setEditForm((prev) => ({ ...prev, timezone: text }))}
                placeholder="e.g. UTC or Africa/Accra"
              />

              <Text style={styles.fieldLabel}>Currency</Text>
              <View style={styles.currencyPills}>
                {CURRENCIES.map((curr) => (
                  <Pressable
                    key={curr}
                    onPress={() => setEditForm((prev) => ({ ...prev, currency: curr }))}
                    style={[styles.choicePill, editForm.currency === curr && styles.choicePillActive]}
                  >
                    <Text style={[styles.choicePillText, editForm.currency === curr && styles.choicePillTextActive]}>
                      {curr}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Lifecycle Status</Text>
              <View style={styles.currencyPills}>
                {(["active", "suspended", "inactive"] as const).map((st) => (
                  <Pressable
                    key={st}
                    onPress={() => setEditForm((prev) => ({ ...prev, status: st }))}
                    style={[styles.choicePill, editForm.status === st && styles.choicePillActive]}
                  >
                    <Text style={[styles.choicePillText, editForm.status === st && styles.choicePillTextActive]}>
                      {st.toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.modalActions}>
                <Pressable
                  style={styles.modalCancelBtn}
                  onPress={() => setEditingStore(null)}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalSaveBtn, busyId === editingStore?.id && { opacity: 0.7 }]}
                  disabled={busyId === editingStore?.id}
                  onPress={() => void handleSaveEdit()}
                >
                  {busyId === editingStore?.id ? (
                    <ActivityIndicator color={Colors.white} size="small" />
                  ) : (
                    <Text style={styles.modalSaveText}>Save Changes</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Inspect Members Modal */}
      <Modal visible={Boolean(inspectingStore)} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="people" size={20} color={Colors.primaryBlue} />
                <View>
                  <Text style={styles.modalTitle}>{inspectingStore?.name}</Text>
                  <Text style={styles.modalSubtitle}>Staff Members & Roles</Text>
                </View>
              </View>
              <Pressable onPress={() => setInspectingStore(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>

            {membersQuery.isLoading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={Colors.primaryBlue} />
                <Text style={styles.loadingText}>Fetching store staff...</Text>
              </View>
            ) : null}

            {membersQuery.isError ? (
              <Text style={styles.error}>{toErrorMessage(membersQuery.error, "Could not load staff members.")}</Text>
            ) : null}

            <ScrollView style={{ maxHeight: 350 }} contentContainerStyle={{ gap: Spacing.xs }}>
              {(membersQuery.data ?? []).map((member) => (
                <View key={member.id} style={styles.memberRow}>
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarText}>
                      {(member.user?.name || "U").slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{member.user?.name || "Unknown User"}</Text>
                    <Text style={styles.memberEmail}>{member.user?.email || "No email"}</Text>
                  </View>
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleBadgeText}>{member.role.toUpperCase()}</Text>
                  </View>
                </View>
              ))}

              {!membersQuery.isLoading && (membersQuery.data ?? []).length === 0 ? (
                <Text style={styles.empty}>No members registered for this store.</Text>
              ) : null}
            </ScrollView>

            <Pressable
              style={[styles.modalSaveBtn, { marginTop: Spacing.sm }]}
              onPress={() => setInspectingStore(null)}
            >
              <Text style={styles.modalSaveText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: Radius.input,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: {
    flex: 1,
    height: "100%",
    fontSize: 13,
    color: Colors.textPrimary,
  },
  filterPills: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 2,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  filterPillActive: {
    backgroundColor: Colors.primaryBlue,
    borderColor: Colors.primaryBlue,
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  filterPillTextActive: {
    color: Colors.white,
    fontWeight: "800",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  heading: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  loadingBox: {
    paddingVertical: Spacing.md,
    alignItems: "center",
    gap: 6,
  },
  loadingText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  storeCard: {
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: 8,
  },
  storeTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  storeName: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  branchTag: {
    backgroundColor: "#eff6ff",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  branchTagText: {
    fontSize: 9,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
  muted: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  status: {
    fontSize: 10,
    fontWeight: "800",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  metaBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textSecondary,
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  metaDetail: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  switchButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primaryBlue,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  switchText: {
    fontSize: 11,
    color: Colors.white,
    fontWeight: "800",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primaryBluePale,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  actionText: {
    fontSize: 11,
    color: Colors.primaryBlue,
    fontWeight: "800",
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff1f2",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  deleteText: {
    fontSize: 11,
    color: Colors.danger,
    fontWeight: "800",
  },
  error: {
    color: Colors.danger,
    fontSize: 13,
  },
  empty: {
    color: Colors.textMuted,
    textAlign: "center",
    paddingVertical: Spacing.md,
  },
  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    padding: Spacing.lg,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textSecondary,
    marginTop: 4,
  },
  currencyPills: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  choicePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.divider,
    backgroundColor: Colors.surface,
  },
  choicePillActive: {
    borderColor: Colors.primaryBlue,
    backgroundColor: Colors.primaryBluePale,
  },
  choicePillText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  choicePillTextActive: {
    color: Colors.primaryBlue,
    fontWeight: "800",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceSecondary,
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  modalSaveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryBlue,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSaveText: {
    fontSize: 13,
    fontWeight: "800",
    color: Colors.white,
  },
  // Members modal
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  memberAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarText: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
  memberName: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  memberEmail: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  roleBadge: {
    backgroundColor: "#eff6ff",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
});
