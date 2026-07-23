import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
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
      Alert.alert("Backup complete", "A local CSV snapshot of the last 30 days was created.");
    } catch (error) {
      Alert.alert("Backup failed", toErrorMessage(error, "Could not create backup export."));
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
          dialogTitle: "Export OmniPOS CSV",
          UTI: "public.comma-separated-values-text",
        });
      } else {
        Alert.alert("CSV exported", `Saved to ${uri}`);
      }
    } catch (error) {
      Alert.alert("Export failed", toErrorMessage(error, "Could not create CSV export"));
    }
  }

  return (
    <AppScrollScreen showBack title="Backup" subtitle="Configure backup frequency, restore points, and CSV export.">
      <SectionCard>
        <Text style={styles.sectionTitle}>Status</Text>
        <Text style={styles.meta}>Last backup: {lastBackup ?? "Not yet run this session"}</Text>
        <Text style={styles.meta}>Destination: Local CSV snapshot (last 30 days)</Text>
      </SectionCard>

      <SectionCard>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Auto backup (daily)</Text>
          <Pressable
            onPress={() => setAutoBackup((v) => !v)}
            style={[styles.switch, autoBackup && styles.switchOn]}
          >
            <View style={[styles.knob, autoBackup && styles.knobOn]} />
          </Pressable>
        </View>
        <Text style={styles.meta}>When enabled, a daily CSV snapshot can be generated from synced store data.</Text>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Advanced</Text>
        <PrimaryButton
          label={running || exportCsv.isPending ? "Running backup..." : "Run backup now"}
          disabled={running || exportCsv.isPending}
          onPress={() => void runBackupNow()}
        />
        <PrimaryButton
          label="Restore from backup"
          variant="outline"
          onPress={() => Alert.alert("Restore unavailable", "Cloud restore will be added in a later release.")}
        />
        <PrimaryButton
          label={exportCsv.isPending ? "Exporting..." : "CSV export"}
          variant="outline"
          disabled={exportCsv.isPending}
          onPress={() => void exportCsvFile()}
        />
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  meta: {
    ...Typography.body,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.sm,
  },
  toggleLabel: {
    ...Typography.body,
    color: Colors.textPrimary,
    fontWeight: "700",
    flex: 1,
  },
  switch: {
    width: 54,
    height: 32,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    paddingHorizontal: 4,
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
});
