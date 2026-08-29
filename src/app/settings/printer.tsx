import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
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
      Alert.alert("Scan Failed", toErrorMessage(err, "Could not scan for Bluetooth printers."));
    }
  }

  async function connect(nextDevice: PrinterDevice) {
    try {
      await pairPrinter.mutateAsync(nextDevice);
      Alert.alert("Printer Paired", `${nextDevice.name} is now connected and ready for printing.`);
    } catch (err) {
      Alert.alert("Pairing Failed", toErrorMessage(err, "Could not connect to the printer."));
    }
  }

  async function onTestPrint() {
    try {
      await testPrint.mutateAsync();
      Alert.alert("Test Receipt Sent", `Sample receipt dispatched to ${device?.name ?? "thermal printer"}.`);
    } catch (err) {
      Alert.alert("Print Failed", toErrorMessage(err, "Could not print test receipt. Check printer power & paper roll."));
    }
  }

  return (
    <AppScrollScreen
      showBack
      title="Receipt Printer"
      subtitle="Connect ESC/POS thermal printers via Bluetooth or Wi-Fi."
    >
      {/* Printer Status Hero Card */}
      <View style={[styles.statusHero, connected ? styles.statusHeroConnected : styles.statusHeroOffline]}>
        <View style={styles.statusHeroLeft}>
          <View style={[styles.statusIconWrap, connected ? styles.statusIconWrapConnected : styles.statusIconWrapOffline]}>
            <Ionicons name="print" size={24} color={connected ? "#15803d" : "#64748b"} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.statusHeroTitle}>{connected ? device?.name : "No Printer Connected"}</Text>
              <View style={[styles.statusBadge, connected ? styles.statusBadgeConnected : styles.statusBadgeOffline]}>
                <Text style={[styles.statusBadgeText, connected ? styles.statusBadgeTextConnected : styles.statusBadgeTextOffline]}>
                  {connected ? "Paired & Ready" : "Offline"}
                </Text>
              </View>
            </View>
            <Text style={styles.statusHeroSub}>
              {connected ? `MAC: ${device?.address || device?.mac || "Bluetooth connection active"}` : "Scan below to discover nearby ESC/POS thermal printers."}
            </Text>
          </View>
        </View>

        {connected ? (
          <Pressable
            style={({ pressed }) => [styles.testPrintBtn, pressed && { opacity: 0.8 }]}
            onPress={() => void onTestPrint()}
          >
            <Ionicons name="receipt-outline" size={16} color={Colors.white} />
            <Text style={styles.testPrintText}>Test Print Sample</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Paper Size Configuration Card */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="document-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Thermal Paper Width</Text>
        </View>

        <View style={styles.paperRow}>
          <Pressable
            style={[styles.paperPill, paperSize === "58mm" && styles.paperPillActive]}
            onPress={() => setPaperSize("58mm")}
          >
            <Ionicons name="newspaper-outline" size={18} color={paperSize === "58mm" ? Colors.primaryBlue : Colors.textMuted} />
            <Text style={[styles.paperPillText, paperSize === "58mm" && styles.paperPillTextActive]}>
              58mm (Compact Mobile)
            </Text>
          </Pressable>

          <Pressable
            style={[styles.paperPill, paperSize === "80mm" && styles.paperPillActive]}
            onPress={() => setPaperSize("80mm")}
          >
            <Ionicons name="newspaper-outline" size={18} color={paperSize === "80mm" ? Colors.primaryBlue : Colors.textMuted} />
            <Text style={[styles.paperPillText, paperSize === "80mm" && styles.paperPillTextActive]}>
              80mm (Standard Desktop)
            </Text>
          </Pressable>
        </View>
      </SectionCard>

      {/* Available Bluetooth Devices */}
      <SectionCard>
        <View style={styles.scanHeaderRow}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="bluetooth-outline" size={20} color={Colors.primaryBlue} />
            <Text style={styles.sectionTitle}>Nearby Bluetooth Devices</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.scanBtn, isFetching && { opacity: 0.6 }, pressed && { opacity: 0.8 }]}
            disabled={isFetching}
            onPress={() => void onScan()}
          >
            {isFetching ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Ionicons name="scan" size={14} color={Colors.white} />
            )}
            <Text style={styles.scanBtnText}>{isFetching ? "Scanning..." : "Scan Devices"}</Text>
          </Pressable>
        </View>

        {isError ? <Text style={styles.error}>{toErrorMessage(error, "Bluetooth scan error.")}</Text> : null}

        <View style={styles.deviceList}>
          {devices.map((item) => {
            const isPaired = device?.address === item.address;
            return (
              <Pressable
                key={item.id}
                style={({ pressed }) => [
                  styles.deviceCard,
                  isPaired && styles.deviceCardPaired,
                  pressed && { opacity: 0.8 },
                ]}
                disabled={pairPrinter.isPending}
                onPress={() => void connect(item)}
              >
                <View style={styles.deviceLeft}>
                  <View style={styles.deviceIconWrap}>
                    <Ionicons name="print-outline" size={20} color={Colors.primaryBlue} />
                  </View>
                  <View>
                    <Text style={styles.deviceName}>{item.name}</Text>
                    <Text style={styles.deviceAddress}>{item.address}</Text>
                  </View>
                </View>

                <View style={[styles.connectPill, isPaired && styles.connectPillPaired]}>
                  <Text style={[styles.connectPillText, isPaired && styles.connectPillTextPaired]}>
                    {isPaired ? "Connected" : "Connect"}
                  </Text>
                </View>
              </Pressable>
            );
          })}

          {!isFetching && devices.length === 0 ? (
            <View style={styles.emptyDeviceBox}>
              <Ionicons name="bluetooth" size={32} color={Colors.textMuted} />
              <Text style={styles.emptyDeviceTitle}>No Bluetooth Printers Discovered</Text>
              <Text style={styles.emptyDeviceSub}>
                Ensure your thermal printer is turned on with Bluetooth pairing enabled, then tap 'Scan Devices'.
              </Text>
            </View>
          ) : null}
        </View>
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  statusHero: {
    borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1,
    gap: Spacing.md,
  },
  statusHeroConnected: {
    backgroundColor: "#f0fdf4",
    borderColor: "#bbf7d0",
  },
  statusHeroOffline: {
    backgroundColor: "#f8fafc",
    borderColor: "#e2e8f0",
  },
  statusHeroLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  statusIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  statusIconWrapConnected: {
    backgroundColor: "#dcfce7",
  },
  statusIconWrapOffline: {
    backgroundColor: "#e2e8f0",
  },
  statusHeroTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  statusBadgeConnected: {
    backgroundColor: "#dcfce7",
  },
  statusBadgeOffline: {
    backgroundColor: "#e2e8f0",
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "800",
  },
  statusBadgeTextConnected: {
    color: "#15803d",
  },
  statusBadgeTextOffline: {
    color: "#64748b",
  },
  statusHeroSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  testPrintBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#16a34a",
    paddingVertical: 10,
    borderRadius: Radius.pill,
  },
  testPrintText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: "700",
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
  paperRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  paperPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    borderRadius: Radius.input,
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: Colors.surface,
  },
  paperPillActive: {
    borderColor: Colors.primaryBlue,
    backgroundColor: Colors.primaryBluePale,
  },
  paperPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  paperPillTextActive: {
    color: Colors.primaryBlue,
    fontWeight: "800",
  },
  scanHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primaryBlue,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  scanBtnText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: "700",
  },
  error: {
    color: Colors.danger,
    fontSize: 12,
    marginBottom: Spacing.xs,
  },
  deviceList: {
    gap: Spacing.xs,
  },
  deviceCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  deviceCardPaired: {
    borderColor: "#16a34a",
    backgroundColor: "#f0fdf4",
  },
  deviceLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  deviceIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  deviceName: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  deviceAddress: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  connectPill: {
    backgroundColor: Colors.primaryBlue,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  connectPillPaired: {
    backgroundColor: "#16a34a",
  },
  connectPillText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: "700",
  },
  connectPillTextPaired: {
    color: Colors.white,
  },
  emptyDeviceBox: {
    alignItems: "center",
    paddingVertical: Spacing.lg,
    gap: 4,
  },
  emptyDeviceTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginTop: 4,
  },
  emptyDeviceSub: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: "center",
    paddingHorizontal: Spacing.md,
  },
});
