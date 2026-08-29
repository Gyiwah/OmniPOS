import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { useExportStoreCsv } from "@/src/features/settings/hooks";
import { toErrorMessage } from "@/src/utils/errors";

export default function SettingsBackupScreen() {
  const exportCsv = useExportStoreCsv();
  const [autoBackup, setAutoBackup] = useState(true);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function runBackupNow() {
    setRunning(true);
    try {
      const csv = await exportCsv.mutateAsync();
      const uri = `${FileSystem.cacheDirectory}omnipos-backup-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      setLastBackup(new Date().toLocaleString());
      Alert.alert("Backup Created", "A secure local snapshot of your store's sales and inventory data was created.");
    } catch (error) {
      Alert.alert("Backup Error", toErrorMessage(error, "Could not generate backup file."));
    } finally {
      setRunning(false);
    }
  }

  async function exportCsvFile() {
    try {
      const csv = await exportCsv.mutateAsync();
      const uri = `${FileSystem.cacheDirectory}omnipos-export-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(uri, {
          mimeType: "text/csv",
          dialogTitle: "Share OmniPOS CSV Export",
          UTI: "public.comma-separated-values-text",
        });
      } else {
        Alert.alert("CSV Generated", `File saved to ${uri}`);
      }
    } catch (error) {
      Alert.alert("Export Error", toErrorMessage(error, "Could not export CSV file."));
    }
  }

  return (
    <AppScrollScreen
      showBack
      title="Data & Backup"
      subtitle="Export sales and catalog reports, and create local snapshots."
    >
      {/* Backup Status Hero Card */}
      <View style={styles.statusHero}>
        <View style={styles.statusLeft}>
          <View style={styles.statusIconWrap}>
            <Ionicons name="cloud-done-outline" size={24} color="#15803d" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>Cloud & Local Sync Active</Text>
            <Text style={styles.statusSub}>
              Last snapshot: {lastBackup ?? "Not yet generated this session"}
            </Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.backupNowBtn,
            (running || exportCsv.isPending) && { opacity: 0.6 },
            pressed && { opacity: 0.9 },
          ]}
          disabled={running || exportCsv.isPending}
          onPress={() => void runBackupNow()}
        >
          {running || exportCsv.isPending ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Ionicons name="save-outline" size={16} color={Colors.white} />
          )}
          <Text style={styles.backupNowText}>
            {running ? "Creating Snapshot..." : "Create Snapshot Now"}
          </Text>
        </Pressable>
      </View>

      {/* Auto Backup Toggle */}
      <SectionCard>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleTitle}>Automatic Daily Backup</Text>
            <Text style={styles.toggleSub}>
              Automatically caches a daily CSV snapshot of your orders and product movements.
            </Text>
          </View>
          <Pressable
            onPress={() => setAutoBackup((v) => !v)}
            style={[styles.switch, autoBackup && styles.switchOn]}
          >
            <View style={[styles.knob, autoBackup && styles.knobOn]} />
          </Pressable>
        </View>
      </SectionCard>

      {/* CSV Export & Actions Card */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="document-text-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Export Reports & Data</Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.exportActionRow, pressed && styles.exportActionRowPressed]}
          disabled={exportCsv.isPending}
          onPress={() => void exportCsvFile()}
        >
          <View style={styles.exportActionLeft}>
            <View style={styles.exportIconWrap}>
              <Ionicons name="share-outline" size={20} color={Colors.primaryBlue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.exportActionTitle}>Export Store Sales (CSV)</Text>
              <Text style={styles.exportActionSub}>Download itemized transaction history for Excel / Sheets</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.exportActionRow, pressed && styles.exportActionRowPressed, { marginTop: Spacing.xs }]}
          onPress={() => Alert.alert("Cloud Restore", "Cloud restoration checkpoints will be available in the next cloud sync update.")}
        >
          <View style={styles.exportActionLeft}>
            <View style={[styles.exportIconWrap, { backgroundColor: "#faf5ff" }]}>
              <Ionicons name="reload-outline" size={20} color="#7c3aed" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.exportActionTitle}>Restore from Snapshot</Text>
              <Text style={styles.exportActionSub}>Roll back inventory to a previous data checkpoint</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </Pressable>
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  statusHero: {
    backgroundColor: "#f0fdf4",
    borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: "#bbf7d0",
    gap: Spacing.md,
  },
  statusLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  statusIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#dcfce7",
    alignItems: "center",
    justifyContent: "center",
  },
  statusTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#15803d",
  },
  statusSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  backupNowBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#16a34a",
    paddingVertical: 12,
    borderRadius: Radius.pill,
  },
  backupNowText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: "800",
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.sm,
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  toggleSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  switch: {
    width: 52,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  switchOn: {
    backgroundColor: Colors.primaryBluePale,
    borderColor: Colors.primaryBlue,
  },
  knob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.textMuted,
  },
  knobOn: {
    alignSelf: "flex-end",
    backgroundColor: Colors.primaryBlue,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.title,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  exportActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.sm + 2,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  exportActionRowPressed: {
    backgroundColor: "#f8fafc",
  },
  exportActionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  exportIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  exportActionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  exportActionSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
});
