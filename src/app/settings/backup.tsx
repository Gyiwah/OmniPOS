import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

export default function SettingsBackupScreen() {
  const [autoBackup, setAutoBackup] = useState(true);

  return (
    <AppScrollScreen showBack title="Backup" subtitle="Configure backup frequency and restore points.">
      <SectionCard>
        <Text style={styles.sectionTitle}>Status</Text>
        <Text style={styles.meta}>Last backup: Today, 04:30 AM</Text>
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

      <PrimaryButton label="Run backup now" onPress={() => {}} />
      <PrimaryButton label="Restore from backup" variant="outline" onPress={() => {}} />
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
