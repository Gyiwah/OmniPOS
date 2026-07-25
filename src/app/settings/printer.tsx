import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrinterStatus } from "@/src/components/molecules/PrinterStatus";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import {
  useBluetoothPrinters,
  usePairPrinter,
  usePrinterAvailability,
  useTestPrint,
} from "@/src/features/printer/hooks";
import type { PrinterDevice } from "@/src/features/printer/types";
import { usePrinterStore } from "@/src/store/printerStore";
import { toErrorMessage } from "@/src/utils/errors";

export default function SettingsPrinterScreen() {
  const device = usePrinterStore((s) => s.device);
  const paperSize = usePrinterStore((s) => s.paperSize);
  const setPrinter = usePrinterStore((s) => s.setPrinter);
  const setPaperSize = usePrinterStore((s) => s.setPaperSize);
  const { nativeAvailable } = usePrinterAvailability();
  const [scanEnabled, setScanEnabled] = useState(false);
  const { data: scanResult, isFetching, refetch, isError, error } = useBluetoothPrinters(scanEnabled);
  const pairPrinter = usePairPrinter();
  const testPrint = useTestPrint();

  const connected = useMemo(() => Boolean(device), [device]);
  const devices = scanResult?.devices ?? [];

  async function onScan() {
    setScanEnabled(true);
    try {
      await refetch();
    } catch (err) {
      Alert.alert("Scan failed", toErrorMessage(err, "Could not scan for Bluetooth printers."));
    }
  }

  async function connect(nextDevice: PrinterDevice) {
    try {
      await pairPrinter.mutateAsync(nextDevice);
      Alert.alert("Printer paired", `${nextDevice.name} is ready for receipts.`);
    } catch (err) {
      Alert.alert("Pair failed", toErrorMessage(err, "Could not connect to the printer."));
    }
  }

  async function onTestPrint() {
    try {
      await testPrint.mutateAsync();
      Alert.alert("Test print sent", `Sample receipt sent to ${device?.name ?? "printer"}.`);
    } catch (err) {
      Alert.alert("Print failed", toErrorMessage(err, "Could not print test receipt."));
    }
  }

  return (
    <AppScrollScreen showBack title="Printer" subtitle="Pair Bluetooth receipt printers and test output.">
      {!nativeAvailable ? (
        <SectionCard>
          <Text style={styles.noticeTitle}>Development build required</Text>
          <Text style={styles.noticeBody}>
            Bluetooth printing uses native modules and does not work in Expo Go. Run a dev build with{" "}
            <Text style={styles.noticeCode}>npm run dev:android</Text> or EAS Build, then return here to pair your
            ESC/POS printer.
          </Text>
        </SectionCard>
      ) : null}

      <SectionCard>
        <PrinterStatus isConnected={connected} macAddress={device?.mac ?? null} />
        {device ? <Text style={styles.meta}>Address: {device.address}</Text> : null}
      </SectionCard>

      <SectionCard>
        <View style={styles.scanHeader}>
          <Text style={styles.sectionTitle}>Available printers</Text>
          <PrimaryButton
            label={isFetching ? "Scanning…" : "Scan"}
            variant="outline"
            fullWidth={false}
            disabled={!nativeAvailable || isFetching}
            onPress={() => void onScan()}
          />
        </View>
        {isError ? <Text style={styles.error}>{toErrorMessage(error, "Scan failed.")}</Text> : null}
        {isFetching ? <ActivityIndicator color={Colors.primaryBlue} /> : null}
        <View style={styles.devicesWrap}>
          {devices.map((item) => (
            <Pressable
              key={item.id}
              style={styles.deviceRow}
              disabled={pairPrinter.isPending}
              onPress={() => void connect(item)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceName}>{item.name}</Text>
                <Text style={styles.deviceMeta}>
                  {item.mac} · {item.connectionType === "ble" ? "BLE" : "Bluetooth Classic"}
                </Text>
              </View>
              <Text style={styles.deviceAction}>{device?.id === item.id ? "Paired" : "Pair"}</Text>
            </Pressable>
          ))}
          {!isFetching && scanEnabled && devices.length === 0 ? (
            <Text style={styles.empty}>No printers found. Make sure the printer is on and paired in system settings.</Text>
          ) : null}
          {!scanEnabled ? <Text style={styles.empty}>Tap Scan to find nearby Bluetooth receipt printers.</Text> : null}
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

      <PrimaryButton
        label={testPrint.isPending ? "Printing…" : "Test print"}
        disabled={!device || testPrint.isPending}
        onPress={() => void onTestPrint()}
      />
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
  scanHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  noticeTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  noticeBody: {
    ...Typography.body,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  noticeCode: {
    fontWeight: "700",
    color: Colors.primaryBlue,
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
  empty: {
    ...Typography.caption,
    color: Colors.textMuted,
    textAlign: "center",
  },
  error: {
    ...Typography.body,
    color: Colors.accentOrange,
    marginBottom: Spacing.xs,
  },
});
