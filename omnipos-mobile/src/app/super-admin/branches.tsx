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

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { TextInput as CustomTextInput } from "@/src/components/atoms/TextInput";
import { SuperAdminNavBar } from "@/src/components/superAdmin/SuperAdminNavBar";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import {
  useCreateBranch,
  useDeleteBranch,
  usePlatformBranches,
  usePlatformStores,
  useUpdateBranch,
} from "@/src/features/superAdmin/hooks";
import type { PlatformBranch } from "@/src/features/superAdmin/types";
import { toErrorMessage } from "@/src/utils/errors";

const STATUS_COLORS: Record<string, string> = {
  active: "#059669",
  suspended: "#d97706",
  inactive: "#64748b",
};

export default function SuperAdminBranchesScreen() {
  const { data: branches = [], isLoading, isError, error, refetch } = usePlatformBranches();
  const { data: stores = [] } = usePlatformStores();

  const createBranchMutation = useCreateBranch();
  const updateBranchMutation = useUpdateBranch();
  const deleteBranchMutation = useDeleteBranch();

  const [query, setQuery] = useState("");
  const [selectedParentFilter, setSelectedParentFilter] = useState<string>("all");

  // Create Branch Form
  const [name, setName] = useState("");
  const [parentStoreId, setParentStoreId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showParentPickerModal, setShowParentPickerModal] = useState(false);

  // Edit Branch State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const parentStores = useMemo(
    () => stores.filter((s) => !s.parentStoreId),
    [stores],
  );

  const filteredBranches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return branches.filter((branch) => {
      const matchesParent =
        selectedParentFilter === "all" || branch.parentStoreId === selectedParentFilter;
      const matchesQuery =
        !needle ||
        branch.name.toLowerCase().includes(needle) ||
        (branch.parentStoreName ?? "").toLowerCase().includes(needle);
      return matchesParent && matchesQuery;
    });
  }, [branches, query, selectedParentFilter]);

  async function handleCreateBranch() {
    if (!name.trim() || !parentStoreId) {
      Alert.alert("Branch Details Required", "Please enter a branch name and choose a parent store.");
      return;
    }
    setBusyId("create");
    try {
      await createBranchMutation.mutateAsync({
        name: name.trim(),
        parentStoreId,
        currency,
      });
      setName("");
      setParentStoreId("");
      setShowCreateModal(false);
      Alert.alert("Branch Created", "The new branch has been established under the parent store.");
    } catch (err) {
      Alert.alert("Create Branch Failed", toErrorMessage(err, "Could not create branch."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveBranchName(branchId: string) {
    if (!editingName.trim()) return;
    setBusyId(branchId);
    try {
      await updateBranchMutation.mutateAsync({
        branchId,
        input: { name: editingName.trim() },
      });
      setEditingId(null);
    } catch (err) {
      Alert.alert("Update Branch Failed", toErrorMessage(err, "Could not update branch name."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleStatus(branch: PlatformBranch) {
    const nextStatus = branch.status === "active" ? "suspended" : "active";
    setBusyId(branch.id);
    try {
      await updateBranchMutation.mutateAsync({
        branchId: branch.id,
        input: { status: nextStatus },
      });
    } catch (err) {
      Alert.alert("Status Change Failed", toErrorMessage(err, "Could not update branch status."));
    } finally {
      setBusyId(null);
    }
  }

  function confirmDelete(branchId: string, branchName: string) {
    Alert.alert("Delete Branch?", `Are you sure you want to delete branch "${branchName}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusyId(branchId);
            try {
              await deleteBranchMutation.mutateAsync(branchId);
              Alert.alert("Branch Removed", `Branch "${branchName}" was deleted.`);
            } catch (err) {
              Alert.alert("Delete Failed", toErrorMessage(err, "Could not delete branch."));
            } finally {
              setBusyId(null);
            }
          })();
        },
      },
    ]);
  }

  const selectedParentStore = parentStores.find((s) => s.id === parentStoreId);

  return (
    <AppScrollScreen
      showBack
      title="Store Branches"
      subtitle="Configure parent store hierarchies and manage secondary branch locations."
      onRefresh={() => void refetch()}
    >
      <SuperAdminNavBar />

      {/* Top Action Bar */}
      <View style={styles.topActions}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search branches or parent store..."
            placeholderTextColor={Colors.textMuted}
            style={styles.searchInput}
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={10}>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <Pressable
          style={styles.createTriggerBtn}
          onPress={() => setShowCreateModal(true)}
        >
          <Ionicons name="add-circle" size={18} color={Colors.white} />
          <Text style={styles.createTriggerText}>New Branch</Text>
        </Pressable>
      </View>

      {/* Parent Filter Pills */}
      {parentStores.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterPills}
        >
          <Pressable
            onPress={() => setSelectedParentFilter("all")}
            style={[styles.filterPill, selectedParentFilter === "all" && styles.filterPillActive]}
          >
            <Text
              style={[
                styles.filterPillText,
                selectedParentFilter === "all" && styles.filterPillTextActive,
              ]}
            >
              ALL PARENTS
            </Text>
          </Pressable>
          {parentStores.map((store) => (
            <Pressable
              key={store.id}
              onPress={() => setSelectedParentFilter(store.id)}
              style={[
                styles.filterPill,
                selectedParentFilter === store.id && styles.filterPillActive,
              ]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  selectedParentFilter === store.id && styles.filterPillTextActive,
                ]}
              >
                {store.name.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Branches List */}
      <SectionCard>
        <View style={styles.listHeader}>
          <Text style={styles.heading}>
            Registered Branches ({filteredBranches.length} of {branches.length})
          </Text>
          <Pressable onPress={() => void refetch()} hitSlop={10}>
            <Ionicons name="refresh-outline" size={20} color={Colors.primaryBlue} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={Colors.primaryBlue} />
            <Text style={styles.loadingText}>Fetching branches...</Text>
          </View>
        ) : null}

        {isError ? <Text style={styles.error}>{toErrorMessage(error, "Could not load branches.")}</Text> : null}

        {filteredBranches.map((branch) => (
          <View key={branch.id} style={styles.branchCard}>
            <View style={styles.branchTop}>
              <View style={{ flex: 1 }}>
                {editingId === branch.id ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <TextInput
                      value={editingName}
                      onChangeText={setEditingName}
                      style={styles.inlineInput}
                      placeholder="Branch name"
                      autoFocus
                    />
                    <Pressable
                      style={styles.saveSmallBtn}
                      onPress={() => void handleSaveBranchName(branch.id)}
                    >
                      <Ionicons name="checkmark" size={16} color={Colors.white} />
                    </Pressable>
                    <Pressable
                      style={styles.cancelSmallBtn}
                      onPress={() => setEditingId(null)}
                    >
                      <Ionicons name="close" size={16} color={Colors.textSecondary} />
                    </Pressable>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="git-branch-outline" size={18} color={Colors.primaryBlue} />
                    <Text style={styles.branchName}>{branch.name}</Text>
                  </View>
                )}
                <Text style={styles.parentMeta}>
                  Parent Store: <Text style={styles.parentBold}>{branch.parentStoreName ?? "Unassigned"}</Text>
                </Text>
              </View>

              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: `${STATUS_COLORS[branch.status] ?? Colors.divider}15` },
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    { color: STATUS_COLORS[branch.status] ?? Colors.textMuted },
                  ]}
                >
                  {branch.status.toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaBadge}>{branch.currency}</Text>
              <Text style={styles.metaDetail}>{branch.membersCount} staff</Text>
              <Text style={styles.metaDetail}>{branch.ordersCount} orders</Text>
            </View>

            <View style={styles.actions}>
              {editingId !== branch.id ? (
                <Pressable
                  style={styles.actionButton}
                  onPress={() => {
                    setEditingId(branch.id);
                    setEditingName(branch.name);
                  }}
                >
                  <Ionicons name="pencil-outline" size={14} color={Colors.primaryBlue} />
                  <Text style={styles.actionText}>Rename</Text>
                </Pressable>
              ) : null}

              <Pressable
                style={styles.actionButton}
                disabled={busyId === branch.id}
                onPress={() => void handleToggleStatus(branch)}
              >
                <Ionicons
                  name={branch.status === "active" ? "pause-outline" : "play-outline"}
                  size={14}
                  color={Colors.primaryBlue}
                />
                <Text style={styles.actionText}>
                  {branch.status === "active" ? "Suspend" : "Activate"}
                </Text>
              </Pressable>

              <Pressable
                style={styles.deleteButton}
                disabled={busyId === branch.id}
                onPress={() => confirmDelete(branch.id, branch.name)}
              >
                <Ionicons name="trash-outline" size={14} color={Colors.danger} />
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>
          </View>
        ))}

        {!isLoading && filteredBranches.length === 0 ? (
          <Text style={styles.empty}>No branches found.</Text>
        ) : null}
      </SectionCard>

      {/* Create Branch Modal */}
      <Modal visible={showCreateModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="add-circle" size={22} color={Colors.primaryBlue} />
                <Text style={styles.modalTitle}>Create New Branch</Text>
              </View>
              <Pressable onPress={() => setShowCreateModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ gap: Spacing.sm }}>
              <CustomTextInput
                label="Branch Location Name *"
                value={name}
                onChangeText={setName}
                placeholder="e.g. Osu Outlet - Branch 2"
                leftIcon={<Ionicons name="business-outline" size={18} color={Colors.textMuted} />}
              />

              <Text style={styles.fieldLabel}>Parent Headquarters Store *</Text>
              <Pressable
                style={styles.parentSelectBox}
                onPress={() => setShowParentPickerModal(true)}
              >
                <Ionicons name="storefront-outline" size={18} color={Colors.primaryBlue} />
                <Text
                  style={[
                    styles.parentSelectText,
                    !selectedParentStore && { color: Colors.textMuted },
                  ]}
                >
                  {selectedParentStore ? selectedParentStore.name : "Tap to choose parent store..."}
                </Text>
                <Ionicons name="chevron-down" size={16} color={Colors.textMuted} />
              </Pressable>

              <CustomTextInput
                label="Currency Code"
                value={currency}
                onChangeText={setCurrency}
                placeholder="e.g. USD or GHS"
              />

              <View style={styles.modalActions}>
                <Pressable
                  style={styles.modalCancelBtn}
                  onPress={() => setShowCreateModal(false)}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalSaveBtn, busyId === "create" && { opacity: 0.7 }]}
                  disabled={busyId === "create"}
                  onPress={() => void handleCreateBranch()}
                >
                  {busyId === "create" ? (
                    <ActivityIndicator color={Colors.white} size="small" />
                  ) : (
                    <Text style={styles.modalSaveText}>Create Branch</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Parent Store Picker Modal */}
      <Modal visible={showParentPickerModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: "60%" }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose Parent Store</Text>
              <Pressable onPress={() => setShowParentPickerModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ gap: 6 }}>
              {parentStores.map((store) => (
                <Pressable
                  key={store.id}
                  style={[
                    styles.pickerChoice,
                    parentStoreId === store.id && styles.pickerChoiceActive,
                  ]}
                  onPress={() => {
                    setParentStoreId(store.id);
                    setShowParentPickerModal(false);
                  }}
                >
                  <Ionicons
                    name="business"
                    size={18}
                    color={parentStoreId === store.id ? Colors.primaryBlue : Colors.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.pickerChoiceTitle,
                        parentStoreId === store.id && styles.pickerChoiceTitleActive,
                      ]}
                    >
                      {store.name}
                    </Text>
                    <Text style={styles.pickerChoiceSub}>
                      {store.currency} - {store.membersCount} staff
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  topActions: {
    flexDirection: "row",
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: Radius.input,
    paddingHorizontal: 10,
    height: 40,
  },
  searchInput: {
    flex: 1,
    height: "100%",
    fontSize: 13,
    color: Colors.textPrimary,
  },
  createTriggerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.primaryBlue,
    borderRadius: Radius.input,
    paddingHorizontal: 12,
    height: 40,
  },
  createTriggerText: {
    color: Colors.white,
    fontWeight: "800",
    fontSize: 12,
  },
  filterPills: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 4,
    marginBottom: Spacing.xs,
  },
  filterPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
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
    fontSize: 10,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  filterPillTextActive: {
    color: Colors.white,
    fontWeight: "800",
  },
  listHeader: {
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
  branchCard: {
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: 6,
  },
  branchTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  branchName: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  parentMeta: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  parentBold: {
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  statusText: {
    fontSize: 9,
    fontWeight: "800",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaBadge: {
    fontSize: 10,
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
    gap: 6,
    marginTop: 2,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionText: {
    color: Colors.primaryBlue,
    fontSize: 11,
    fontWeight: "800",
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff1f2",
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deleteText: {
    color: Colors.danger,
    fontSize: 11,
    fontWeight: "800",
  },
  inlineInput: {
    flex: 1,
    height: 34,
    borderWidth: 1,
    borderColor: Colors.primaryBlue,
    borderRadius: 6,
    paddingHorizontal: 8,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  saveSmallBtn: {
    backgroundColor: Colors.primaryBlue,
    borderRadius: 6,
    padding: 7,
  },
  cancelSmallBtn: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 6,
    padding: 7,
  },
  error: {
    color: Colors.danger,
    fontSize: 13,
  },
  empty: {
    textAlign: "center",
    color: Colors.textMuted,
    paddingVertical: Spacing.md,
  },
  // Modal styles
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
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textSecondary,
    marginTop: 4,
  },
  parentSelectBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: Radius.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
  },
  parentSelectText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textPrimary,
    fontWeight: "600",
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
  pickerChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: Radius.input,
    padding: 10,
  },
  pickerChoiceActive: {
    borderColor: Colors.primaryBlue,
    backgroundColor: Colors.primaryBluePale,
  },
  pickerChoiceTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  pickerChoiceTitleActive: {
    color: Colors.primaryBlue,
    fontWeight: "800",
  },
  pickerChoiceSub: {
    fontSize: 11,
    color: Colors.textMuted,
  },
});
