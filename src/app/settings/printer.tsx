import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrinterStatus } from "@/src/components/molecules/PrinterStatus";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

export default function SettingsPrinterScreen() {
  const [isConnected, setConnected] = useState(false);

  return (
    <AppScrollScreen showBack title="Printer" subtitle="Pair a Bluetooth receipt printer and test output.">
      <SectionCard>
        <PrinterStatus
          isConnected={isConnected}
          macAddress={isConnected ? "00:1A:7D:DA:71:13" : null}
          onPress={() => setConnected((v) => !v)}
        />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Print settings</Text>
        <View style={styles.metaWrap}>
          <Text style={styles.meta}>Paper width: 80mm</Text>
          <Text style={styles.meta}>Auto-cut: Enabled</Text>
          <Text style={styles.meta}>Header logo: Enabled</Text>
        </View>
      </SectionCard>

      <PrimaryButton label="Test print" onPress={() => {}} />
      <PrimaryButton label="Pair new printer" variant="outline" onPress={() => setConnected(false)} />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  metaWrap: {
    gap: Spacing.xs,
  },
  meta: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
});
