import { useMemo } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrinterStatus } from "@/src/components/molecules/PrinterStatus";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { printerService } from "@/src/services/printer";
import { usePrinterStore } from "@/src/store/printerStore";

type PrinterDevice = { id: string; name: string; mac: string };

const MOCK_DEVICES: PrinterDevice[] = [
  { id: "p1", name: "POS-Frontdesk", mac: "00:1A:7D:DA:71:13" },
  { id: "p2", name: "POS-Backoffice", mac: "00:1A:7D:DA:71:14" },
];

export default function SettingsPrinterScreen() {
  const device = usePrinterStore((s) => s.device);
  const paperSize = usePrinterStore((s) => s.paperSize);
  const setPrinter = usePrinterStore((s) => s.setPrinter);
  const setPaperSize = usePrinterStore((s) => s.setPaperSize);

  const connected = useMemo(() => Boolean(device), [device]);

  function connect(nextDevice: PrinterDevice) {
    setPrinter(nextDevice);
    Alert.alert("Printer paired", `${nextDevice.name} connected.`);
  }

  async function testPrint() {
    await printerService.printReceipt();
    Alert.alert("Test print", `Printing sample receipt to ${device?.name ?? "selected printer"}...`);
  }

  return (
    <AppScrollScreen showBack title="Printer" subtitle="Pair Bluetooth receipt printers and test output.">
      <SectionCard>
        <PrinterStatus isConnected={connected} macAddress={device?.mac ?? null} />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Available printers</Text>
        <View style={styles.devicesWrap}>
          {MOCK_DEVICES.map((item) => (
            <Pressable key={item.id} style={styles.deviceRow} onPress={() => connect(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceName}>{item.name}</Text>
                <Text style={styles.deviceMeta}>{item.mac}</Text>
              </View>
              <Text style={styles.deviceAction}>{device?.id === item.id ? "Paired" : "Pair"}</Text>
            </Pressable>
          ))}
        </View>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Print settings</Text>
        <View style={styles.row}>
          <Text style={styles.meta}>Paper size</Text>
          <View style={styles.pills}>
            {(["58mm", "80mm"] as const).map((size) => (
              <Pressable
                key={size}
                onPress={() => setPaperSize(size)}
                style={[styles.pill, paperSize === size && styles.pillActive]}
              >
                <Text style={[styles.pillLabel, paperSize === size && styles.pillLabelActive]}>{size}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </SectionCard>

      <PrimaryButton label="Test print" disabled={!device} onPress={() => void testPrint()} />
      <PrimaryButton label="Unpair printer" variant="outline" disabled={!device} onPress={() => setPrinter(null)} />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  devicesWrap: {
    gap: Spacing.sm,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  deviceName: {
    ...Typography.body,
    color: Colors.textPrimary,
    fontWeight: "700",
  },
  deviceMeta: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  deviceAction: {
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
  row: {
    gap: Spacing.xs,
  },
  meta: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
  pills: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  pill: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  pillActive: {
    borderColor: Colors.primaryBlue,
    backgroundColor: Colors.primaryBluePale,
  },
  pillLabel: {
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  pillLabelActive: {
    color: Colors.primaryBlue,
  },
});
