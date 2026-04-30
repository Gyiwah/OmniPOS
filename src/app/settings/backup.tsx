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

export default function SettingsBackupScreen() {
  const [autoBackup, setAutoBackup] = useState(true);
  const [lastBackup, setLastBackup] = useState("Today, 04:30 AM");
  const [running, setRunning] = useState(false);

  async function runBackupNow() {
    setRunning(true);
    setTimeout(() => {
      setLastBackup(new Date().toLocaleString());
      setRunning(false);
    }, 900);
  }

  async function exportCsv() {
    try {
      const csv = [
        "date,metric,value",
        `${new Date().toISOString()},orders,24`,
        `${new Date().toISOString()},sales,1880.40`,
        `${new Date().toISOString()},returns,3`,
      ].join("\n");
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
      Alert.alert("Export failed", error instanceof Error ? error.message : "Could not create CSV export");
    }
  }

  return (
    <AppScrollScreen showBack title="Backup" subtitle="Configure backup frequency, restore points, and CSV export.">
      <SectionCard>
        <Text style={styles.sectionTitle}>Status</Text>
        <Text style={styles.meta}>Last backup: {lastBackup}</Text>
        <Text style={styles.meta}>Destination: Secure cloud vault</Text>
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
        <Text style={styles.meta}>When enabled, sales + inventory data is synced every day.</Text>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Advanced</Text>
        <PrimaryButton label={running ? "Running backup..." : "Run backup now"} disabled={running} onPress={() => void runBackupNow()} />
        <PrimaryButton label="Restore from backup" variant="outline" onPress={() => {}} />
        <PrimaryButton label="CSV export" variant="outline" onPress={() => void exportCsv()} />
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
