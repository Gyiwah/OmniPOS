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
  useCreatePerson,
  useDeletePerson,
  usePlatformPeople,
  usePlatformStores,
  useSetPlatformAdmin,
  useUpdatePerson,
  useUpdateStoreMembershipRole,
} from "@/src/features/superAdmin/hooks";
import type { CreatePersonInput, PlatformPerson } from "@/src/features/superAdmin/types";
import { toErrorMessage } from "@/src/utils/errors";
import { useAuthStore } from "@/src/store/authStore";

const ROLES = ["admin", "manager", "cashier"] as const;

export default function SuperAdminPeopleScreen() {
  const currentUserId = useAuthStore((s) => s.userId);
  const { data: people = [], isLoading, isError, error, refetch } = usePlatformPeople();
  const { data: stores = [] } = usePlatformStores();

  const createPersonMutation = useCreatePerson();
  const updatePersonMutation = useUpdatePerson();
  const setPlatformAdminMutation = useSetPlatformAdmin();
  const updateRoleMutation = useUpdateStoreMembershipRole();
  const deletePersonMutation = useDeletePerson();

  const [query, setQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "admins" | "staff">("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create Person Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreatePersonInput>({
    name: "",
    email: "",
    password: "",
    isSuperAdmin: false,
    storeId: "",
    role: "cashier",
  });

  // Edit Person Modal State
  const [editingPerson, setEditingPerson] = useState<PlatformPerson | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");

  // Change Role Modal State
  const [roleModalPerson, setRoleModalPerson] = useState<PlatformPerson | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [selectedRole, setSelectedRole] = useState<(typeof ROLES)[number]>("cashier");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return people.filter((person) => {
      const matchesTab =
        filterTab === "all" ||
        (filterTab === "admins" && person.isSuperAdmin) ||
        (filterTab === "staff" && !person.isSuperAdmin);

      const matchesSearch =
        !needle ||
        person.name.toLowerCase().includes(needle) ||
        person.email.toLowerCase().includes(needle);

      return matchesTab && matchesSearch;
    });
  }, [people, query, filterTab]);

  async function handleCreatePerson() {
    if (!createForm.name.trim() || !createForm.email.trim() || !createForm.password) {
      Alert.alert("Required Fields", "Please enter name, email, and password.");
      return;
    }
    if (createForm.password.length < 8) {
      Alert.alert("Password Too Short", "Password must be at least 8 characters long.");
      return;
    }

    setBusyId("create");
    try {
      await createPersonMutation.mutateAsync({
        name: createForm.name.trim(),
        email: createForm.email.trim().toLowerCase(),
        password: createForm.password,
        isSuperAdmin: createForm.isSuperAdmin,
        storeId: createForm.storeId || undefined,
        role: createForm.storeId ? createForm.role : undefined,
      });
      setShowCreateModal(false);
      setCreateForm({
        name: "",
        email: "",
        password: "",
        isSuperAdmin: false,
        storeId: "",
        role: "cashier",
      });
      Alert.alert("Person Created", "User account has been provisioned successfully.");
    } catch (err) {
      Alert.alert("Creation Failed", toErrorMessage(err, "Could not create person."));
    } finally {
      setBusyId(null);
    }
  }

  function handleOpenEdit(person: PlatformPerson) {
    setEditingPerson(person);
    setEditName(person.name);
    setEditEmail(person.email);
    setEditPassword("");
  }

  async function handleSaveEdit() {
    if (!editingPerson || !editName.trim() || !editEmail.trim()) {
      Alert.alert("Invalid Input", "Name and email are required.");
      return;
    }
    if (editPassword && editPassword.length < 8) {
      Alert.alert("Password Too Short", "Password must be at least 8 characters.");
      return;
    }

    setBusyId(editingPerson.id);
    try {
      await updatePersonMutation.mutateAsync({
        userId: editingPerson.id,
        input: {
          name: editName.trim(),
          email: editEmail.trim().toLowerCase(),
          password: editPassword || undefined,
        },
      });
      setEditingPerson(null);
      Alert.alert("Person Updated", "Account details updated successfully.");
    } catch (err) {
      Alert.alert("Update Failed", toErrorMessage(err, "Could not update account."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleAdmin(id: string, current: boolean) {
    setBusyId(id);
    try {
      await setPlatformAdminMutation.mutateAsync({ userId: id, isSuperAdmin: !current });
    } catch (err) {
      Alert.alert("Access Update Failed", toErrorMessage(err, "Could not update platform access."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveRole() {
    if (!roleModalPerson || !selectedStoreId) {
      Alert.alert("Store Selection Required", "Please select a store to assign a role.");
      return;
    }
    setBusyId(roleModalPerson.id);
    try {
      await updateRoleMutation.mutateAsync({
        userId: roleModalPerson.id,
        storeId: selectedStoreId,
        role: selectedRole,
      });
      setRoleModalPerson(null);
      Alert.alert("Role Updated", `Role updated to ${selectedRole} for this store.`);
    } catch (err) {
      Alert.alert("Role Update Failed", toErrorMessage(err, "Could not update store role."));
    } finally {
      setBusyId(null);
    }
  }

  function confirmDelete(id: string, name: string) {
    Alert.alert("Delete Person?", `Are you sure you want to permanently delete account for ${name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusyId(id);
            try {
              await deletePersonMutation.mutateAsync(id);
              Alert.alert("Person Removed", `${name} was deleted from the platform.`);
            } catch (err) {
              Alert.alert("Delete Failed", toErrorMessage(err, "Could not delete person."));
            } finally {
              setBusyId(null);
            }
          })();
        },
      },
    ]);
  }

  return (
    <AppScrollScreen
      showBack
      title="People & Identity"
      subtitle="Platform administrator privileges and tenant store memberships."
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
            placeholder="Search name or email..."
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
          style={styles.addTriggerBtn}
          onPress={() => setShowCreateModal(true)}
        >
          <Ionicons name="person-add" size={16} color={Colors.white} />
          <Text style={styles.addTriggerText}>Add Person</Text>
        </Pressable>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterPills}>
        {[
          { key: "all", label: "ALL USERS" },
          { key: "admins", label: "PLATFORM ADMINS" },
          { key: "staff", label: "STORE STAFF" },
        ].map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setFilterTab(tab.key as any)}
            style={[styles.filterPill, filterTab === tab.key && styles.filterPillActive]}
          >
            <Text style={[styles.filterPillText, filterTab === tab.key && styles.filterPillTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* People List */}
      <SectionCard>
        <View style={styles.header}>
          <Text style={styles.heading}>
            Accounts ({filtered.length} of {people.length})
          </Text>
          <Pressable onPress={() => void refetch()} hitSlop={10}>
            <Ionicons name="refresh-outline" size={20} color={Colors.primaryBlue} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={Colors.primaryBlue} />
            <Text style={styles.loadingText}>Fetching accounts...</Text>
          </View>
        ) : null}

        {isError ? <Text style={styles.error}>{toErrorMessage(error, "Could not load accounts.")}</Text> : null}

        {filtered.map((person) => {
          const isSelf = person.id === currentUserId;

          return (
            <View key={person.id} style={styles.personCard}>
              <View style={styles.personTop}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{person.name.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Text style={styles.name}>{person.name}</Text>
                    {isSelf ? (
                      <View style={styles.youBadge}>
                        <Text style={styles.youBadgeText}>YOU</Text>
                      </View>
                    ) : null}
                    {person.isSuperAdmin ? (
                      <View style={styles.adminBadge}>
                        <Text style={styles.adminBadgeText}>PLATFORM ADMIN</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.meta}>{person.email}</Text>
                </View>
              </View>

              {/* Store Memberships Preview */}
              <View style={styles.membershipList}>
                {person.memberStores.length > 0 ? (
                  person.memberStores.map((m) => (
                    <View key={m.storeId} style={styles.membershipBadge}>
                      <Ionicons name="storefront-outline" size={12} color={Colors.textSecondary} />
                      <Text style={styles.membershipStore}>{m.storeName || "Store"}:</Text>
                      <Text style={styles.membershipRole}>{m.role.toUpperCase()}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noMemberships}>No store memberships assigned</Text>
                )}
              </View>

              {/* Action Buttons */}
              <View style={styles.actions}>
                <Pressable
                  style={styles.actionButton}
                  onPress={() => handleOpenEdit(person)}
                >
                  <Ionicons name="pencil-outline" size={14} color={Colors.primaryBlue} />
                  <Text style={styles.actionText}>Edit</Text>
                </Pressable>

                <Pressable
                  style={styles.actionButton}
                  onPress={() => {
                    setRoleModalPerson(person);
                    setSelectedStoreId(person.memberStores[0]?.storeId ?? "");
                    setSelectedRole(person.memberStores[0]?.role ?? "cashier");
                  }}
                >
                  <Ionicons name="key-outline" size={14} color={Colors.primaryBlue} />
                  <Text style={styles.actionText}>Assign Store Role</Text>
                </Pressable>

                {!isSelf ? (
                  <>
                    <Pressable
                      style={styles.actionButton}
                      disabled={busyId === person.id}
                      onPress={() => void handleToggleAdmin(person.id, person.isSuperAdmin)}
                    >
                      <Ionicons
                        name={person.isSuperAdmin ? "shield-outline" : "shield-checkmark-outline"}
                        size={14}
                        color={Colors.primaryBlue}
                      />
                      <Text style={styles.actionText}>
                        {person.isSuperAdmin ? "Demote" : "Promote Admin"}
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.deleteButton}
                      disabled={busyId === person.id}
                      onPress={() => confirmDelete(person.id, person.name)}
                    >
                      <Ionicons name="trash-outline" size={14} color={Colors.danger} />
                      <Text style={styles.deleteText}>Delete</Text>
                    </Pressable>
                  </>
                ) : (
                  <View style={styles.selfBadge}>
                    <Text style={styles.selfBadgeText}>Current Session (Protected)</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}

        {!isLoading && filtered.length === 0 ? (
          <Text style={styles.empty}>No accounts match this search.</Text>
        ) : null}
      </SectionCard>

      {/* Add Person Modal */}
      <Modal visible={showCreateModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="person-add" size={20} color={Colors.primaryBlue} />
                <Text style={styles.modalTitle}>Add Person</Text>
              </View>
              <Pressable onPress={() => setShowCreateModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ gap: Spacing.sm }}>
              <CustomTextInput
                label="Full Name *"
                value={createForm.name}
                onChangeText={(v) => setCreateForm((p) => ({ ...p, name: v }))}
                placeholder="e.g. Kwame Mensah"
              />

              <CustomTextInput
                label="Email Address *"
                value={createForm.email}
                onChangeText={(v) => setCreateForm((p) => ({ ...p, email: v }))}
                placeholder="kwame@company.com"
                autoCapitalize="none"
                keyboardType="email-address"
              />

              <CustomTextInput
                label="Initial Password * (min 8 chars)"
                value={createForm.password}
                onChangeText={(v) => setCreateForm((p) => ({ ...p, password: v }))}
                placeholder="Secure password"
                secureTextEntry
              />

              <Pressable
                style={styles.toggleRow}
                onPress={() => setCreateForm((p) => ({ ...p, isSuperAdmin: !p.isSuperAdmin }))}
              >
                <Ionicons
                  name={createForm.isSuperAdmin ? "checkbox" : "square-outline"}
                  size={20}
                  color={createForm.isSuperAdmin ? Colors.primaryBlue : Colors.textMuted}
                />
                <Text style={styles.toggleText}>Grant Super Admin (Platform) Access</Text>
              </Pressable>

              <Text style={styles.fieldLabel}>Assign Store (Optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                <Pressable
                  style={[styles.choicePill, !createForm.storeId && styles.choicePillActive]}
                  onPress={() => setCreateForm((p) => ({ ...p, storeId: "" }))}
                >
                  <Text style={[styles.choicePillText, !createForm.storeId && styles.choicePillTextActive]}>
                    No Store
                  </Text>
                </Pressable>
                {stores.map((s) => (
                  <Pressable
                    key={s.id}
                    style={[styles.choicePill, createForm.storeId === s.id && styles.choicePillActive]}
                    onPress={() => setCreateForm((p) => ({ ...p, storeId: s.id }))}
                  >
                    <Text
                      style={[
                        styles.choicePillText,
                        createForm.storeId === s.id && styles.choicePillTextActive,
                      ]}
                    >
                      {s.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {createForm.storeId ? (
                <>
                  <Text style={styles.fieldLabel}>Store Role</Text>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {ROLES.map((r) => (
                      <Pressable
                        key={r}
                        style={[styles.choicePill, createForm.role === r && styles.choicePillActive]}
                        onPress={() => setCreateForm((p) => ({ ...p, role: r }))}
                      >
                        <Text
                          style={[
                            styles.choicePillText,
                            createForm.role === r && styles.choicePillTextActive,
                          ]}
                        >
                          {r.toUpperCase()}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              <View style={styles.modalActions}>
                <Pressable style={styles.modalCancelBtn} onPress={() => setShowCreateModal(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalSaveBtn, busyId === "create" && { opacity: 0.7 }]}
                  disabled={busyId === "create"}
                  onPress={() => void handleCreatePerson()}
                >
                  {busyId === "create" ? (
                    <ActivityIndicator color={Colors.white} size="small" />
                  ) : (
                    <Text style={styles.modalSaveText}>Create Account</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit Person Modal */}
      <Modal visible={Boolean(editingPerson)} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="create-outline" size={20} color={Colors.primaryBlue} />
                <Text style={styles.modalTitle}>Edit Account</Text>
              </View>
              <Pressable onPress={() => setEditingPerson(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ gap: Spacing.sm }}>
              <CustomTextInput
                label="Full Name *"
                value={editName}
                onChangeText={setEditName}
                placeholder="Full name"
              />

              <CustomTextInput
                label="Email Address *"
                value={editEmail}
                onChangeText={setEditEmail}
                placeholder="Email"
                autoCapitalize="none"
                keyboardType="email-address"
              />

              <CustomTextInput
                label="Reset Password (leave blank to keep current)"
                value={editPassword}
                onChangeText={setEditPassword}
                placeholder="New password (min 8 chars)"
                secureTextEntry
              />

              <View style={styles.modalActions}>
                <Pressable style={styles.modalCancelBtn} onPress={() => setEditingPerson(null)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalSaveBtn, busyId === editingPerson?.id && { opacity: 0.7 }]}
                  disabled={busyId === editingPerson?.id}
                  onPress={() => void handleSaveEdit()}
                >
                  {busyId === editingPerson?.id ? (
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

      {/* Assign Store Role Modal */}
      <Modal visible={Boolean(roleModalPerson)} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="business" size={20} color={Colors.primaryBlue} />
                <Text style={styles.modalTitle}>Assign Store Role</Text>
              </View>
              <Pressable onPress={() => setRoleModalPerson(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>

            <Text style={styles.modalSubtitle}>
              Managing store membership for <Text style={{ fontWeight: "700" }}>{roleModalPerson?.name}</Text>
            </Text>

            <Text style={styles.fieldLabel}>Select Store</Text>
            <ScrollView style={{ maxHeight: 150 }} contentContainerStyle={{ gap: 6 }}>
              {stores.map((s) => (
                <Pressable
                  key={s.id}
                  style={[styles.choicePill, selectedStoreId === s.id && styles.choicePillActive]}
                  onPress={() => setSelectedStoreId(s.id)}
                >
                  <Text
                    style={[
                      styles.choicePillText,
                      selectedStoreId === s.id && styles.choicePillTextActive,
                    ]}
                  >
                    {s.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.fieldLabel}>Select Role</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {ROLES.map((r) => (
                <Pressable
                  key={r}
                  style={[styles.choicePill, selectedRole === r && styles.choicePillActive]}
                  onPress={() => setSelectedRole(r)}
                >
                  <Text
                    style={[
                      styles.choicePillText,
                      selectedRole === r && styles.choicePillTextActive,
                    ]}
                  >
                    {r.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={() => setRoleModalPerson(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalSaveBtn, busyId === roleModalPerson?.id && { opacity: 0.7 }]}
                disabled={busyId === roleModalPerson?.id}
                onPress={() => void handleSaveRole()}
              >
                {busyId === roleModalPerson?.id ? (
                  <ActivityIndicator color={Colors.white} size="small" />
                ) : (
                  <Text style={styles.modalSaveText}>Assign Role</Text>
                )}
              </Pressable>
            </View>
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
  addTriggerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.primaryBlue,
    borderRadius: Radius.input,
    paddingHorizontal: 12,
    height: 40,
  },
  addTriggerText: {
    color: Colors.white,
    fontWeight: "800",
    fontSize: 12,
  },
  filterPills: {
    flexDirection: "row",
    gap: 6,
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
  personCard: {
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: 8,
  },
  personTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontWeight: "800",
    color: Colors.primaryBlue,
    fontSize: 15,
  },
  name: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  meta: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  youBadge: {
    backgroundColor: "#eff6ff",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  youBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
  adminBadge: {
    backgroundColor: "#f5f3ff",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#ddd6fe",
  },
  adminBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#7c3aed",
  },
  membershipList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  membershipBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
  },
  membershipStore: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  membershipRole: {
    fontSize: 10,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
  noMemberships: {
    fontSize: 11,
    color: Colors.textMuted,
    fontStyle: "italic",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
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
  selfBadge: {
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  selfBadgeText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: "700",
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
    marginBottom: Spacing.sm,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textSecondary,
    marginTop: 4,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: Spacing.xs,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
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
});
