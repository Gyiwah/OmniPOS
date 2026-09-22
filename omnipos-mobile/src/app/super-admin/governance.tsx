import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
  useAssignSubscription,
  useCreateGlobalCategory,
  useCreatePlan,
  useDeleteGlobalCategory,
  useDeletePlan,
  usePlatformBilling,
  usePlatformResources,
  usePlatformStores,
  useUpdateGlobalCategory,
  useUpdatePlan,
  useUpdateSystemSetting,
} from "@/src/features/superAdmin/hooks";
import type { GlobalCategory, PlatformPlan } from "@/src/features/superAdmin/types";
import { toErrorMessage } from "@/src/utils/errors";

export default function SuperAdminGovernanceScreen() {
  const billing = usePlatformBilling();
  const resources = usePlatformResources();
  const stores = usePlatformStores();

  const createPlanMutation = useCreatePlan();
  const updatePlanMutation = useUpdatePlan();
  const deletePlanMutation = useDeletePlan();
  const assignSubMutation = useAssignSubscription();

  const createCategoryMutation = useCreateGlobalCategory();
  const updateCategoryMutation = useUpdateGlobalCategory();
  const deleteCategoryMutation = useDeleteGlobalCategory();
  const updateSettingMutation = useUpdateSystemSetting();

  const [segment, setSegment] = useState<"billing" | "catalogues" | "settings">("billing");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Assign Plan State
  const [assignStoreId, setAssignStoreId] = useState("");
  const [assignPlanId, setAssignPlanId] = useState("");
  const [showAssignModal, setShowAssignModal] = useState(false);

  // Plan Modals State
  const [showCreatePlanModal, setShowCreatePlanModal] = useState(false);
  const [planName, setPlanName] = useState("");
  const [planSlug, setPlanSlug] = useState("");
  const [planPrice, setPlanPrice] = useState("49");
  const [planDesc, setPlanDesc] = useState("");
  const [editingPlan, setEditingPlan] = useState<PlatformPlan | null>(null);

  // Category Modals State
  const [showCreateCategoryModal, setShowCreateCategoryModal] = useState(false);
  const [catName, setCatName] = useState("");
  const [catSlug, setCatSlug] = useState("");
  const [catPosition, setCatPosition] = useState("0");
  const [editingCategory, setEditingCategory] = useState<GlobalCategory | null>(null);

  const refreshing = billing.isRefetching || resources.isRefetching || stores.isRefetching;

  async function refresh() {
    await Promise.all([billing.refetch(), resources.refetch(), stores.refetch()]);
  }

  // Handle Plan Actions
  async function handleCreatePlan() {
    if (!planName.trim() || !planSlug.trim() || isNaN(Number(planPrice))) {
      Alert.alert("Invalid Input", "Please enter a valid plan name, slug, and monthly price.");
      return;
    }
    setBusyId("create-plan");
    try {
      await createPlanMutation.mutateAsync({
        name: planName.trim(),
        slug: planSlug.trim().toLowerCase(),
        description: planDesc.trim() || undefined,
        monthlyPrice: Number(planPrice),
      });
      setShowCreatePlanModal(false);
      setPlanName("");
      setPlanSlug("");
      setPlanPrice("49");
      setPlanDesc("");
      Alert.alert("Plan Created", "Subscription plan added successfully.");
    } catch (err) {
      Alert.alert("Create Plan Failed", toErrorMessage(err, "Could not create plan."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveEditPlan() {
    if (!editingPlan) return;
    setBusyId(editingPlan.id);
    try {
      await updatePlanMutation.mutateAsync({
        planId: editingPlan.id,
        input: {
          name: editingPlan.name,
          monthlyPrice: editingPlan.monthlyPrice,
          status: editingPlan.status,
        },
      });
      setEditingPlan(null);
      Alert.alert("Plan Updated", "Plan changes saved successfully.");
    } catch (err) {
      Alert.alert("Update Failed", toErrorMessage(err, "Could not update plan."));
    } finally {
      setBusyId(null);
    }
  }

  function confirmDeletePlan(plan: PlatformPlan) {
    Alert.alert("Archive Plan?", `Archive subscription plan "${plan.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        style: "destructive",
        onPress: async () => {
          setBusyId(plan.id);
          try {
            await deletePlanMutation.mutateAsync(plan.id);
          } catch (err) {
            Alert.alert("Archive Failed", toErrorMessage(err, "Could not archive plan."));
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }

  // Handle Subscription Assignment
  async function handleAssignSubscription() {
    if (!assignStoreId || !assignPlanId) {
      Alert.alert("Selection Required", "Please select both a store and a plan.");
      return;
    }
    setBusyId("assign-sub");
    try {
      await assignSubMutation.mutateAsync({
        storeId: assignStoreId,
        planId: assignPlanId,
      });
      setShowAssignModal(false);
      Alert.alert("Subscription Assigned", "The store's subscription plan has been updated.");
    } catch (err) {
      Alert.alert("Assignment Failed", toErrorMessage(err, "Could not assign subscription."));
    } finally {
      setBusyId(null);
    }
  }

  // Handle Category Actions
  async function handleCreateCategory() {
    if (!catName.trim() || !catSlug.trim()) {
      Alert.alert("Invalid Input", "Category name and slug are required.");
      return;
    }
    setBusyId("create-cat");
    try {
      await createCategoryMutation.mutateAsync({
        name: catName.trim(),
        slug: catSlug.trim().toLowerCase(),
        position: Number(catPosition) || 0,
      });
      setShowCreateCategoryModal(false);
      setCatName("");
      setCatSlug("");
      setCatPosition("0");
      Alert.alert("Category Created", "Global catalogue category added.");
    } catch (err) {
      Alert.alert("Creation Failed", toErrorMessage(err, "Could not create category."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveEditCategory() {
    if (!editingCategory) return;
    setBusyId(editingCategory.id);
    try {
      await updateCategoryMutation.mutateAsync({
        categoryId: editingCategory.id,
        input: {
          name: editingCategory.name,
          slug: editingCategory.slug,
          position: editingCategory.position,
          status: editingCategory.status as any,
        },
      });
      setEditingCategory(null);
    } catch (err) {
      Alert.alert("Update Failed", toErrorMessage(err, "Could not update category."));
    } finally {
      setBusyId(null);
    }
  }

  function confirmDeleteCategory(category: GlobalCategory) {
    Alert.alert("Delete Category?", `Remove global category "${category.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusyId(category.id);
          try {
            await deleteCategoryMutation.mutateAsync(category.id);
          } catch (err) {
            Alert.alert("Delete Failed", toErrorMessage(err, "Could not delete category."));
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }

  // System Settings Helpers
  const settingsMap = useMemo(() => {
    return new Map((resources.data?.settings ?? []).map((s) => [s.key, s]));
  }, [resources.data]);

  const maintenanceSetting = settingsMap.get("platform.maintenance");
  const isMaintenanceEnabled = Boolean(
    (maintenanceSetting?.value as { enabled?: boolean })?.enabled,
  );

  async function handleToggleMaintenance(nextVal: boolean) {
    Alert.alert(
      nextVal ? "Enable Maintenance Mode?" : "Disable Maintenance Mode?",
      nextVal
        ? "When enabled, stores and tills are notified that the platform is undergoing maintenance."
        : "Restore regular platform operations for all stores?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: nextVal ? "Enable Maintenance" : "Disable",
          style: nextVal ? "destructive" : "default",
          onPress: async () => {
            setBusyId("maintenance");
            try {
              await updateSettingMutation.mutateAsync({
                key: "platform.maintenance",
                value: { enabled: nextVal },
                description: "Platform maintenance mode switch",
              });
            } catch (err) {
              Alert.alert("Setting Failed", toErrorMessage(err, "Could not update setting."));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  }

  return (
    <AppScrollScreen
      showBack
      title="Platform Governance"
      subtitle="Billing plans, tenant subscriptions, global product catalogues, and platform configurations."
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    >
      <SuperAdminNavBar />

      {/* Segment Selector */}
      <View style={styles.segmentContainer}>
        {[
          { key: "billing", label: "Billing & Plans", icon: "receipt-outline" as const },
          { key: "catalogues", label: "Global Catalogues", icon: "layers-outline" as const },
          { key: "settings", label: "Platform Settings", icon: "settings-outline" as const },
        ].map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setSegment(tab.key as any)}
            style={[styles.segmentBtn, segment === tab.key && styles.segmentBtnActive]}
          >
            <Ionicons
              name={tab.icon}
              size={15}
              color={segment === tab.key ? Colors.primaryBlue : Colors.textSecondary}
            />
            <Text style={[styles.segmentText, segment === tab.key && styles.segmentTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* SEGMENT 1: BILLING & PLANS */}
      {segment === "billing" ? (
        <>
          {/* Subscription Plans Card */}
          <SectionCard>
            <View style={styles.cardHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="receipt" size={18} color={Colors.primaryBlue} />
                <Text style={styles.title}>Subscription Plans</Text>
              </View>
              <Pressable
                style={styles.addSmallBtn}
                onPress={() => setShowCreatePlanModal(true)}
              >
                <Ionicons name="add" size={16} color={Colors.white} />
                <Text style={styles.addSmallText}>New Plan</Text>
              </Pressable>
            </View>

            {billing.isLoading ? <ActivityIndicator color={Colors.primaryBlue} /> : null}
            {billing.isError ? (
              <Text style={styles.error}>{toErrorMessage(billing.error, "Could not load billing plans.")}</Text>
            ) : null}

            {(billing.data?.plans ?? []).map((plan) => (
              <View key={plan.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{plan.name}</Text>
                  <Text style={styles.itemMeta}>
                    {plan.subscriptionsCount} active subscriptions · {plan.status}
                  </Text>
                </View>
                <Text style={styles.planPrice}>${plan.monthlyPrice.toFixed(2)}/mo</Text>

                <View style={{ flexDirection: "row", gap: 4, marginLeft: 8 }}>
                  <Pressable
                    style={styles.actionIconBtn}
                    onPress={() => setEditingPlan(plan)}
                  >
                    <Ionicons name="pencil" size={14} color={Colors.primaryBlue} />
                  </Pressable>
                  <Pressable
                    style={styles.actionIconBtn}
                    disabled={busyId === plan.id}
                    onPress={() => confirmDeletePlan(plan)}
                  >
                    <Ionicons name="trash-outline" size={14} color={Colors.danger} />
                  </Pressable>
                </View>
              </View>
            ))}
          </SectionCard>

          {/* Active Store Subscriptions */}
          <SectionCard>
            <View style={styles.cardHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="card-outline" size={18} color={Colors.primaryBlue} />
                <Text style={styles.title}>Store Subscriptions</Text>
              </View>
              <Pressable
                style={styles.assignSubTriggerBtn}
                onPress={() => setShowAssignModal(true)}
              >
                <Ionicons name="swap-horizontal" size={15} color={Colors.white} />
                <Text style={styles.assignSubTriggerText}>Assign Plan</Text>
              </Pressable>
            </View>

            {(billing.data?.subscriptions ?? []).map((sub) => (
              <View key={sub.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{sub.storeName || "Unassigned Store"}</Text>
                  <Text style={styles.itemMeta}>
                    Plan: <Text style={{ fontWeight: "700" }}>{sub.planName || "No Plan"}</Text> · {sub.status}
                  </Text>
                </View>
                <Text style={styles.itemMeta}>
                  {sub.monthlyPrice != null ? `$${sub.monthlyPrice.toFixed(2)}` : "Free"}
                </Text>
              </View>
            ))}

            {!billing.isLoading && (billing.data?.subscriptions ?? []).length === 0 ? (
              <Text style={styles.emptyNotice}>No subscriptions active.</Text>
            ) : null}
          </SectionCard>
        </>
      ) : null}

      {/* SEGMENT 2: GLOBAL CATALOGUES */}
      {segment === "catalogues" ? (
        <SectionCard>
          <View style={styles.cardHeaderRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="layers" size={18} color={Colors.primaryBlue} />
              <Text style={styles.title}>Global Categories</Text>
            </View>
            <Pressable
              style={styles.addSmallBtn}
              onPress={() => setShowCreateCategoryModal(true)}
            >
              <Ionicons name="add" size={16} color={Colors.white} />
              <Text style={styles.addSmallText}>New Category</Text>
            </Pressable>
          </View>

          {resources.isLoading ? <ActivityIndicator color={Colors.primaryBlue} /> : null}
          {resources.isError ? (
            <Text style={styles.error}>{toErrorMessage(resources.error, "Could not load categories.")}</Text>
          ) : null}

          {(resources.data?.categories ?? []).map((cat) => (
            <View key={cat.id} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{cat.name}</Text>
                <Text style={styles.itemMeta}>
                  slug: {cat.slug} · order: {cat.position} · status: {cat.status}
                </Text>
              </View>

              <View style={{ flexDirection: "row", gap: 6 }}>
                <Pressable
                  style={styles.actionIconBtn}
                  onPress={() => setEditingCategory(cat)}
                >
                  <Ionicons name="pencil" size={14} color={Colors.primaryBlue} />
                </Pressable>
                <Pressable
                  style={styles.actionIconBtn}
                  disabled={busyId === cat.id}
                  onPress={() => confirmDeleteCategory(cat)}
                >
                  <Ionicons name="trash-outline" size={14} color={Colors.danger} />
                </Pressable>
              </View>
            </View>
          ))}

          {!resources.isLoading && (resources.data?.categories ?? []).length === 0 ? (
            <Text style={styles.emptyNotice}>No global categories defined yet.</Text>
          ) : null}
        </SectionCard>
      ) : null}

      {/* SEGMENT 3: PLATFORM SETTINGS */}
      {segment === "settings" ? (
        <SectionCard>
          <View style={styles.cardHeaderRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="settings" size={18} color={Colors.primaryBlue} />
              <Text style={styles.title}>Platform Settings & Flags</Text>
            </View>
          </View>

          {/* Maintenance Mode Setting */}
          <View style={styles.settingCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingTitle}>Platform Maintenance Mode</Text>
              <Text style={styles.settingDesc}>
                When enabled, stores receive maintenance notices and sync sync queues pause.
              </Text>
            </View>
            <Switch
              value={isMaintenanceEnabled}
              onValueChange={(val) => void handleToggleMaintenance(val)}
              trackColor={{ false: Colors.divider, true: Colors.danger }}
            />
          </View>

          {/* System Defaults */}
          <View style={styles.settingCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingTitle}>Registered Settings Keys</Text>
              <Text style={styles.settingDesc}>
                {resources.data?.settings.length ?? 0} active configuration settings managed by platform engine.
              </Text>
            </View>
            <Ionicons name="checkmark-circle" size={20} color="#059669" />
          </View>
        </SectionCard>
      ) : null}

      {/* Assign Plan Modal */}
      <Modal visible={showAssignModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Assign Store Subscription</Text>
              <Pressable onPress={() => setShowAssignModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Select Store</Text>
            <ScrollView style={{ maxHeight: 160 }} contentContainerStyle={{ gap: 6 }}>
              {stores.data
                ?.filter((s) => !s.parentStoreId)
                .map((s) => (
                  <Pressable
                    key={s.id}
                    style={[styles.choicePill, assignStoreId === s.id && styles.choicePillActive]}
                    onPress={() => setAssignStoreId(s.id)}
                  >
                    <Text
                      style={[
                        styles.choicePillText,
                        assignStoreId === s.id && styles.choicePillTextActive,
                      ]}
                    >
                      {s.name}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>

            <Text style={styles.fieldLabel}>Select Plan</Text>
            <ScrollView style={{ maxHeight: 160 }} contentContainerStyle={{ gap: 6 }}>
              {billing.data?.plans.map((p) => (
                <Pressable
                  key={p.id}
                  style={[styles.choicePill, assignPlanId === p.id && styles.choicePillActive]}
                  onPress={() => setAssignPlanId(p.id)}
                >
                  <Text
                    style={[
                      styles.choicePillText,
                      assignPlanId === p.id && styles.choicePillTextActive,
                    ]}
                  >
                    {p.name} - ${p.monthlyPrice.toFixed(2)}/mo
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={() => setShowAssignModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalSaveBtn, busyId === "assign-sub" && { opacity: 0.7 }]}
                disabled={busyId === "assign-sub"}
                onPress={() => void handleAssignSubscription()}
              >
                {busyId === "assign-sub" ? (
                  <ActivityIndicator color={Colors.white} size="small" />
                ) : (
                  <Text style={styles.modalSaveText}>Assign Plan</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create Plan Modal */}
      <Modal visible={showCreatePlanModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Subscription Plan</Text>
              <Pressable onPress={() => setShowCreatePlanModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ gap: Spacing.sm }}>
              <CustomTextInput label="Plan Name *" value={planName} onChangeText={setPlanName} placeholder="e.g. Starter Pro" />
              <CustomTextInput label="Slug Code *" value={planSlug} onChangeText={setPlanSlug} placeholder="e.g. starter-pro" autoCapitalize="none" />
              <CustomTextInput label="Monthly Price (USD) *" value={planPrice} onChangeText={setPlanPrice} keyboardType="numeric" placeholder="49" />
              <CustomTextInput label="Description" value={planDesc} onChangeText={setPlanDesc} placeholder="Features and limits" />

              <View style={styles.modalActions}>
                <Pressable style={styles.modalCancelBtn} onPress={() => setShowCreatePlanModal(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.modalSaveBtn} disabled={busyId === "create-plan"} onPress={() => void handleCreatePlan()}>
                  <Text style={styles.modalSaveText}>Create Plan</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit Plan Modal */}
      <Modal visible={Boolean(editingPlan)} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Plan</Text>
              <Pressable onPress={() => setEditingPlan(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>

            {editingPlan ? (
              <ScrollView contentContainerStyle={{ gap: Spacing.sm }}>
                <CustomTextInput
                  label="Plan Name"
                  value={editingPlan.name}
                  onChangeText={(v) => setEditingPlan((p) => (p ? { ...p, name: v } : null))}
                />
                <CustomTextInput
                  label="Monthly Price"
                  value={String(editingPlan.monthlyPrice)}
                  onChangeText={(v) => setEditingPlan((p) => (p ? { ...p, monthlyPrice: Number(v) || 0 } : null))}
                  keyboardType="numeric"
                />

                <View style={styles.modalActions}>
                  <Pressable style={styles.modalCancelBtn} onPress={() => setEditingPlan(null)}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.modalSaveBtn} onPress={() => void handleSaveEditPlan()}>
                    <Text style={styles.modalSaveText}>Save Changes</Text>
                  </Pressable>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Create Category Modal */}
      <Modal visible={showCreateCategoryModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Global Category</Text>
              <Pressable onPress={() => setShowCreateCategoryModal(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ gap: Spacing.sm }}>
              <CustomTextInput label="Category Name *" value={catName} onChangeText={setCatName} placeholder="e.g. Beverages" />
              <CustomTextInput label="Slug Code *" value={catSlug} onChangeText={setCatSlug} placeholder="e.g. beverages" autoCapitalize="none" />
              <CustomTextInput label="Display Position" value={catPosition} onChangeText={setCatPosition} keyboardType="numeric" placeholder="0" />

              <View style={styles.modalActions}>
                <Pressable style={styles.modalCancelBtn} onPress={() => setShowCreateCategoryModal(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.modalSaveBtn} onPress={() => void handleCreateCategory()}>
                  <Text style={styles.modalSaveText}>Create Category</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit Category Modal */}
      <Modal visible={Boolean(editingCategory)} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Global Category</Text>
              <Pressable onPress={() => setEditingCategory(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>

            {editingCategory ? (
              <ScrollView contentContainerStyle={{ gap: Spacing.sm }}>
                <CustomTextInput
                  label="Category Name"
                  value={editingCategory.name}
                  onChangeText={(v) => setEditingCategory((p) => (p ? { ...p, name: v } : null))}
                />
                <CustomTextInput
                  label="Slug"
                  value={editingCategory.slug}
                  onChangeText={(v) => setEditingCategory((p) => (p ? { ...p, slug: v } : null))}
                />
                <CustomTextInput
                  label="Display Position"
                  value={String(editingCategory.position)}
                  onChangeText={(v) => setEditingCategory((p) => (p ? { ...p, position: Number(v) || 0 } : null))}
                  keyboardType="numeric"
                />

                <View style={styles.modalActions}>
                  <Pressable style={styles.modalCancelBtn} onPress={() => setEditingCategory(null)}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.modalSaveBtn} onPress={() => void handleSaveEditCategory()}>
                    <Text style={styles.modalSaveText}>Save Changes</Text>
                  </Pressable>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  segmentContainer: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    padding: 3,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.divider,
    marginBottom: Spacing.sm,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    borderRadius: Radius.pill,
  },
  segmentBtnActive: {
    backgroundColor: Colors.primaryBluePale,
  },
  segmentText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  segmentTextActive: {
    color: Colors.primaryBlue,
    fontWeight: "800",
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  addSmallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primaryBlue,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  addSmallText: {
    fontSize: 11,
    fontWeight: "800",
    color: Colors.white,
  },
  assignSubTriggerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primaryBlue,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  assignSubTriggerText: {
    fontSize: 11,
    fontWeight: "800",
    color: Colors.white,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  itemName: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  itemMeta: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  planPrice: {
    fontSize: 13,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
  actionIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  settingCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: Spacing.sm,
  },
  settingTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  settingDesc: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  emptyNotice: {
    textAlign: "center",
    color: Colors.textMuted,
    paddingVertical: Spacing.md,
    fontSize: 12,
  },
  error: {
    color: Colors.danger,
    fontSize: 13,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textSecondary,
    marginTop: 6,
    marginBottom: 4,
  },
  choicePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
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
