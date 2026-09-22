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
import { SuperAdminNavBar } from "@/src/components/superAdmin/SuperAdminNavBar";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import {
  usePlatformAuditLogs,
  usePlatformDevices,
  usePlatformSync,
  useUpdateDeviceStatus,
} from "@/src/features/superAdmin/hooks";
import type { PlatformAuditLog, PlatformDevice } from "@/src/features/superAdmin/types";
import { toErrorMessage } from "@/src/utils/errors";

const STATUS_COLORS: Record<string, string> = {
  active: "#059669",
  inactive: "#64748b",
  revoked: "#dc2626",
};

export default function SuperAdminOperationsScreen() {
  const devices = usePlatformDevices();
  const sync = usePlatformSync();
  const audit = usePlatformAuditLogs();
  const updateDeviceMutation = useUpdateDeviceStatus();

  const [activeTab, setActiveTab] = useState<"sync" | "devices" | "audit">("sync");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [selectedAuditLog, setSelectedAuditLog] = useState<PlatformAuditLog | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);

  const refreshing = devices.isRefetching || sync.isRefetching || audit.isRefetching;

  async function refresh() {
    await Promise.all([devices.refetch(), sync.refetch(), audit.refetch()]);
  }

  const filteredDevices = useMemo(() => {
    const q = deviceSearch.trim().toLowerCase();
    return (devices.data ?? []).filter((d) => {
      return (
        !q ||
        (d.terminalLabel ?? "").toLowerCase().includes(q) ||
        d.platform.toLowerCase().includes(q) ||
        (d.storeName ?? "").toLowerCase().includes(q) ||
        (d.userName ?? "").toLowerCase().includes(q)
      );
    });
  }, [devices.data, deviceSearch]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return (audit.data ?? []).filter((log) => {
      return (
        !q ||
        log.action.toLowerCase().includes(q) ||
        (log.actorName ?? "").toLowerCase().includes(q) ||
        (log.entityType ?? "").toLowerCase().includes(q)
      );
    });
  }, [audit.data, auditSearch]);

  function handleToggleDeviceStatus(device: PlatformDevice) {
    const isCurrentlyActive = device.status === "active";
    const nextStatus = isCurrentlyActive ? "revoked" : "active";

    Alert.alert(
      isCurrentlyActive ? "Revoke Device?" : "Activate Device?",
      isCurrentlyActive
        ? `Are you sure you want to revoke "${device.terminalLabel || device.platform}"? It will be blocked from syncing with the platform.`
        : `Activate "${device.terminalLabel || device.platform}" for store ${device.storeName || "Unassigned"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isCurrentlyActive ? "Revoke Terminal" : "Activate",
          style: isCurrentlyActive ? "destructive" : "default",
          onPress: async () => {
            setBusyDeviceId(device.id);
            try {
              await updateDeviceMutation.mutateAsync({
                deviceId: device.id,
                status: nextStatus,
              });
            } catch (err) {
              Alert.alert("Device Update Failed", toErrorMessage(err, "Could not update device status."));
            } finally {
              setBusyDeviceId(null);
            }
          },
        },
      ],
    );
  }

  return (
    <AppScrollScreen
      showBack
      title="Platform Operations"
      subtitle="Device authorization, sync health, conflict tracking, and security audit logs."
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    >
      <SuperAdminNavBar />

      {/* Segment Selector */}
      <View style={styles.segmentContainer}>
        {[
          { key: "sync", label: "Sync Monitor", icon: "sync-outline" as const },
          { key: "devices", label: `Devices (${devices.data?.length ?? 0})`, icon: "phone-portrait-outline" as const },
          { key: "audit", label: "Audit Trail", icon: "shield-checkmark-outline" as const },
        ].map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setActiveTab(tab.key as any)}
            style={[styles.segmentBtn, activeTab === tab.key && styles.segmentBtnActive]}
          >
            <Ionicons
              name={tab.icon}
              size={15}
              color={activeTab === tab.key ? Colors.primaryBlue : Colors.textSecondary}
            />
            <Text style={[styles.segmentText, activeTab === tab.key && styles.segmentTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* TAB 1: SYNCHRONIZATION HEALTH */}
      {activeTab === "sync" ? (
        <>
          <SectionCard>
            <View style={styles.heading}>
              <Ionicons name="sync" size={20} color={Colors.primaryBlue} />
              <Text style={styles.title}>Live Estate Synchronization</Text>
            </View>

            {sync.isLoading ? <ActivityIndicator color={Colors.primaryBlue} /> : null}
            {sync.isError ? (
              <Text style={styles.error}>{toErrorMessage(sync.error, "Could not load sync health.")}</Text>
            ) : null}

            {sync.data ? (
              <View style={styles.metrics}>
                <Metric
                  label="Stores Online"
                  value={`${sync.data.summary.storesOnline}/${sync.data.summary.storesTotal}`}
                  icon="business-outline"
                />
                <Metric
                  label="Devices Online"
                  value={`${sync.data.summary.devicesOnline}/${sync.data.summary.devicesTotal}`}
                  icon="phone-portrait-outline"
                />
                <Metric
                  label="Pending Queue"
                  value={String(sync.data.summary.pendingOperations)}
                  icon="time-outline"
                />
                <Metric
                  label="Sync Conflicts"
                  value={String(sync.data.summary.openConflicts)}
                  icon="alert-circle-outline"
                  isWarning={sync.data.summary.openConflicts > 0}
                />
              </View>
            ) : null}
          </SectionCard>

          {/* Recent Sync Failures */}
          <SectionCard>
            <View style={styles.heading}>
              <Ionicons name="warning-outline" size={20} color={Colors.danger} />
              <Text style={styles.title}>
                Recent Failures & Conflicts ({sync.data?.recentFailures.length ?? 0})
              </Text>
            </View>

            {(sync.data?.recentFailures ?? []).length === 0 ? (
              <View style={styles.cleanState}>
                <Ionicons name="checkmark-circle" size={32} color="#059669" />
                <Text style={styles.cleanTitle}>All queues are clear</Text>
                <Text style={styles.cleanSub}>No sync errors or conflicts across any tenant stores.</Text>
              </View>
            ) : (
              (sync.data?.recentFailures ?? []).map((failure) => (
                <View key={failure.operationId} style={styles.failureRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={styles.failureEntity}>{failure.entity.toUpperCase()}</Text>
                      <Text style={styles.failureStatus}>{failure.status}</Text>
                    </View>
                    <Text style={styles.failureStore}>
                      Store: {failure.store || "Unknown"} · Terminal: {failure.device || "Unknown"}
                    </Text>
                    {failure.error ? (
                      <Text style={styles.failureError}>{failure.error}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.failureDate}>
                    {new Date(failure.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
              ))
            )}
          </SectionCard>
        </>
      ) : null}

      {/* TAB 2: TERMINALS & DEVICES */}
      {activeTab === "devices" ? (
        <SectionCard>
          <View style={styles.toolbar}>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
              <TextInput
                value={deviceSearch}
                onChangeText={setDeviceSearch}
                placeholder="Search label, platform, store..."
                placeholderTextColor={Colors.textMuted}
                style={styles.searchInput}
              />
              {deviceSearch ? (
                <Pressable onPress={() => setDeviceSearch("")} hitSlop={10}>
                  <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          </View>

          {devices.isLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={Colors.primaryBlue} />
              <Text style={styles.loadingText}>Loading registered devices...</Text>
            </View>
          ) : null}

          {devices.isError ? (
            <Text style={styles.error}>{toErrorMessage(devices.error, "Could not load devices.")}</Text>
          ) : null}

          {filteredDevices.map((device) => {
            const isRevoked = device.status === "revoked";

            return (
              <View key={device.id} style={styles.deviceRow}>
                <View style={styles.deviceLeft}>
                  <View
                    style={[
                      styles.deviceIconCircle,
                      { backgroundColor: isRevoked ? "#fee2e2" : Colors.primaryBluePale },
                    ]}
                  >
                    <Ionicons
                      name={device.platform.toLowerCase().includes("ios") ? "logo-apple" : "phone-portrait-outline"}
                      size={18}
                      color={isRevoked ? Colors.danger : Colors.primaryBlue}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.deviceName}>{device.terminalLabel || device.platform}</Text>
                    <Text style={styles.meta}>
                      Store: <Text style={{ fontWeight: "700" }}>{device.storeName || "Unassigned"}</Text> · App:{" "}
                      {device.appVersion || "v1.0"}
                    </Text>
                    <Text style={styles.meta}>
                      Last seen:{" "}
                      {device.lastSeenAt
                        ? new Date(device.lastSeenAt).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Never"}
                    </Text>
                  </View>
                </View>

                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: `${STATUS_COLORS[device.status] ?? Colors.divider}15` },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        { color: STATUS_COLORS[device.status] ?? Colors.textMuted },
                      ]}
                    >
                      {device.status.toUpperCase()}
                    </Text>
                  </View>

                  <Pressable
                    style={[
                      styles.deviceActionBtn,
                      isRevoked ? styles.activateBtn : styles.revokeBtn,
                      busyDeviceId === device.id && { opacity: 0.6 },
                    ]}
                    disabled={busyDeviceId === device.id}
                    onPress={() => handleToggleDeviceStatus(device)}
                  >
                    {busyDeviceId === device.id ? (
                      <ActivityIndicator size="small" color={isRevoked ? Colors.primaryBlue : Colors.danger} />
                    ) : (
                      <Text style={[styles.deviceActionText, isRevoked ? { color: Colors.primaryBlue } : { color: Colors.danger }]}>
                        {isRevoked ? "Activate" : "Revoke"}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            );
          })}

          {!devices.isLoading && filteredDevices.length === 0 ? (
            <Text style={styles.emptyNotice}>No devices match this search.</Text>
          ) : null}
        </SectionCard>
      ) : null}

      {/* TAB 3: AUDIT TRAIL */}
      {activeTab === "audit" ? (
        <SectionCard>
          <View style={styles.toolbar}>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
              <TextInput
                value={auditSearch}
                onChangeText={setAuditSearch}
                placeholder="Search action or operator..."
                placeholderTextColor={Colors.textMuted}
                style={styles.searchInput}
              />
              {auditSearch ? (
                <Pressable onPress={() => setAuditSearch("")} hitSlop={10}>
                  <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          </View>

          {audit.isLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={Colors.primaryBlue} />
              <Text style={styles.loadingText}>Fetching audit records...</Text>
            </View>
          ) : null}

          {audit.isError ? (
            <Text style={styles.error}>{toErrorMessage(audit.error, "Could not load audit trail.")}</Text>
          ) : null}

          {filteredAuditLogs.map((log) => (
            <Pressable
              key={log.id}
              style={({ pressed }) => [styles.auditRow, pressed && { backgroundColor: Colors.surfaceSecondary }]}
              onPress={() => setSelectedAuditLog(log)}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={styles.auditAction}>{log.action}</Text>
                </View>
                <Text style={styles.auditMeta}>
                  Actor: <Text style={{ fontWeight: "700" }}>{log.actorName || "System"}</Text> ·{" "}
                  {new Date(log.createdAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
            </Pressable>
          ))}

          {!audit.isLoading && filteredAuditLogs.length === 0 ? (
            <Text style={styles.emptyNotice}>No audit logs found.</Text>
          ) : null}
        </SectionCard>
      ) : null}

      {/* Audit Log Detail Modal */}
      <Modal visible={Boolean(selectedAuditLog)} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="shield-checkmark" size={20} color={Colors.primaryBlue} />
                <Text style={styles.modalTitle}>Audit Event Detail</Text>
              </View>
              <Pressable onPress={() => setSelectedAuditLog(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>

            {selectedAuditLog ? (
              <ScrollView contentContainerStyle={{ gap: Spacing.sm }}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Action</Text>
                  <Text style={styles.detailValue}>{selectedAuditLog.action}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Actor</Text>
                  <Text style={styles.detailValue}>{selectedAuditLog.actorName || "System / API"}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Entity</Text>
                  <Text style={styles.detailValue}>
                    {selectedAuditLog.entityType || "platform"} (ID: {selectedAuditLog.entityId || "N/A"})
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>IP Address</Text>
                  <Text style={styles.detailValue}>{selectedAuditLog.ipAddress || "Localhost / Internal"}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Timestamp</Text>
                  <Text style={styles.detailValue}>{new Date(selectedAuditLog.createdAt).toLocaleString()}</Text>
                </View>

                {selectedAuditLog.before ? (
                  <View style={styles.jsonBox}>
                    <Text style={styles.jsonTitle}>Before State</Text>
                    <Text style={styles.jsonCode}>
                      {JSON.stringify(selectedAuditLog.before, null, 2)}
                    </Text>
                  </View>
                ) : null}

                {selectedAuditLog.after ? (
                  <View style={styles.jsonBox}>
                    <Text style={styles.jsonTitle}>After State</Text>
                    <Text style={styles.jsonCode}>
                      {JSON.stringify(selectedAuditLog.after, null, 2)}
                    </Text>
                  </View>
                ) : null}

                <Pressable
                  style={styles.modalCloseBtn}
                  onPress={() => setSelectedAuditLog(null)}
                >
                  <Text style={styles.modalCloseText}>Close Inspector</Text>
                </Pressable>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </AppScrollScreen>
  );
}

function Metric({
  label,
  value,
  icon,
  isWarning,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  isWarning?: boolean;
}) {
  return (
    <View style={[styles.metric, isWarning && styles.metricWarning]}>
      <Ionicons
        name={icon}
        size={18}
        color={isWarning ? Colors.danger : Colors.primaryBlue}
      />
      <Text style={[styles.metricValue, isWarning && { color: Colors.danger }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
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
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: Spacing.xs,
  },
  title: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  metric: {
    width: "48%",
    backgroundColor: Colors.primaryBluePale,
    padding: Spacing.sm,
    borderRadius: Radius.input,
    gap: 2,
  },
  metricWarning: {
    backgroundColor: "#fee2e2",
  },
  metricValue: {
    fontSize: 20,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
  metricLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: "600",
  },
  cleanState: {
    alignItems: "center",
    paddingVertical: Spacing.md,
    gap: 4,
  },
  cleanTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#059669",
  },
  cleanSub: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: "center",
  },
  failureRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: Spacing.xs,
  },
  failureEntity: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.danger,
  },
  failureStatus: {
    fontSize: 10,
    color: Colors.textMuted,
    textTransform: "uppercase",
  },
  failureStore: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  failureError: {
    fontSize: 11,
    color: Colors.danger,
    marginTop: 2,
    fontFamily: "monospace",
  },
  failureDate: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  toolbar: {
    marginBottom: Spacing.xs,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: Radius.input,
    paddingHorizontal: 10,
    height: 38,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    color: Colors.textPrimary,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: Spacing.xs,
  },
  deviceLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  deviceIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  deviceName: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  meta: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  statusText: {
    fontSize: 9,
    fontWeight: "800",
  },
  deviceActionBtn: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  revokeBtn: {
    borderColor: "#fecdd3",
    backgroundColor: "#fff1f2",
  },
  activateBtn: {
    borderColor: "#bfdbfe",
    backgroundColor: Colors.primaryBluePale,
  },
  deviceActionText: {
    fontSize: 10,
    fontWeight: "800",
  },
  auditRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  auditAction: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  auditMeta: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
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
  // Modal
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
  detailRow: {
    paddingVertical: 4,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textMuted,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
    marginTop: 1,
  },
  jsonBox: {
    backgroundColor: "#0f172a",
    borderRadius: Radius.input,
    padding: Spacing.sm,
    marginTop: 4,
  },
  jsonTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#94a3b8",
    marginBottom: 4,
  },
  jsonCode: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "#38bdf8",
  },
  modalCloseBtn: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: Radius.pill,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: Spacing.sm,
  },
  modalCloseText: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
});
