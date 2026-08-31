import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

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
import { useSettingsStore } from "@/src/store/settingsStore";
import { toErrorMessage } from "@/src/utils/errors";

export default function SettingsPrinterScreen() {
  const device = usePrinterStore((s) => s.device);
  const paperSize = usePrinterStore((s) => s.paperSize);
  const autoPrintReceipts = usePrinterStore((s) => s.autoPrintReceipts);
  const autoCutPaper = usePrinterStore((s) => s.autoCutPaper);
  const footerMessage = usePrinterStore((s) => s.footerMessage);

  const setPrinter = usePrinterStore((s) => s.setPrinter);
  const setPaperSize = usePrinterStore((s) => s.setPaperSize);
  const setAutoPrintReceipts = usePrinterStore((s) => s.setAutoPrintReceipts);
  const setAutoCutPaper = usePrinterStore((s) => s.setAutoCutPaper);
  const setFooterMessage = usePrinterStore((s) => s.setFooterMessage);

  const shopName = useSettingsStore((s) => s.shopName);
  const currency = useSettingsStore((s) => s.currency);
  const taxRate = useSettingsStore((s) => s.taxRate);

  const { nativeAvailable } = usePrinterAvailability();
  const [scanEnabled, setScanEnabled] = useState(false);
  const { data: scanResult, isFetching, refetch, isError, error } = useBluetoothPrinters(scanEnabled);
  const pairPrinter = usePairPrinter();
  const testPrint = useTestPrint();

  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [editingFooter, setEditingFooter] = useState(false);
  const [footerDraft, setFooterDraft] = useState(footerMessage || "Thank you for your business!");

  const [networkIp, setNetworkIp] = useState("");
  const [networkPort, setNetworkPort] = useState("9100");
  const [activeTab, setActiveTab] = useState<"bluetooth" | "network">("bluetooth");

  const connected = useMemo(() => Boolean(device), [device]);
  const devices = scanResult?.devices ?? [];

  async function onScan() {
    if (!nativeAvailable) {
      Alert.alert(
        "Development Build Required",
        "Bluetooth hardware scanning requires native Bluetooth drivers. In Expo Go, receipt rendering and layout preview are active, but hardware dispatching requires a standalone or development build (EAS / APK)."
      );
      return;
    }
    setScanEnabled(true);
    try {
      await refetch();
    } catch (err) {
      Alert.alert("Scan Failed", toErrorMessage(err, "Could not scan for Bluetooth printers."));
    }
  }

  async function connect(nextDevice: PrinterDevice) {
    if (!nativeAvailable) {
      // Allow simulator/dev testing pairing
      setPrinter(nextDevice);
      Alert.alert("Printer Selected (Preview Mode)", `${nextDevice.name} selected as active target printer.`);
      return;
    }

    setConnectingId(nextDevice.id);
    try {
      await pairPrinter.mutateAsync(nextDevice);
      Alert.alert("Printer Connected", `${nextDevice.name} is now connected and ready for printing.`);
    } catch (err) {
      Alert.alert("Pairing Failed", toErrorMessage(err, "Could not connect to the printer. Check power & pairing."));
    } finally {
      setConnectingId(null);
    }
  }

  function disconnectPrinter() {
    Alert.alert(
      "Disconnect Printer",
      `Are you sure you want to disconnect ${device?.name ?? "the current printer"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            setPrinter(null);
          },
        },
      ]
    );
  }

  async function onTestPrint() {
    if (!nativeAvailable) {
      setShowPreviewModal(true);
      return;
    }

    try {
      await testPrint.mutateAsync();
      Alert.alert("Test Receipt Sent", `Sample receipt dispatched to ${device?.name ?? "thermal printer"}.`);
    } catch (err) {
      Alert.alert("Print Failed", toErrorMessage(err, "Could not print test receipt. Check power & paper roll."));
    }
  }

  function connectNetworkPrinter() {
    if (!networkIp.trim()) {
      Alert.alert("IP Required", "Please enter a valid IP address (e.g. 192.168.1.100).");
      return;
    }
    const cleanIp = networkIp.trim();
    const port = networkPort.trim() || "9100";
    const netDevice: PrinterDevice = {
      id: `NET_${cleanIp}_${port}`,
      name: `Network Printer (${cleanIp})`,
      mac: `${cleanIp}:${port}`,
      address: `lan:${cleanIp}:${port}`,
      connectionType: "network",
    };
    setPrinter(netDevice);
    Alert.alert("Network Printer Configured", `Target set to TCP socket ${cleanIp}:${port}`);
  }

  return (
    <AppScrollScreen
      showBack
      title="Receipt Printer"
      subtitle="ESC/POS thermal printer setup, layout calibration & automated checkout slips."
    >
      {/* 1. Native Environment Banner (if running in Expo Go) */}
      {!nativeAvailable && (
        <View style={styles.nativeNoticeCard}>
          <View style={styles.nativeNoticeIconWrap}>
            <Ionicons name="hardware-chip-outline" size={20} color="#b45309" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.nativeNoticeTitleRow}>
              <Text style={styles.nativeNoticeTitle}>Expo Go Hardware Emulation</Text>
              <View style={styles.emulatorBadge}>
                <Text style={styles.emulatorBadgeText}>Virtual Driver</Text>
              </View>
            </View>
            <Text style={styles.nativeNoticeSub}>
              Visual layout calibration and receipt previews are fully functional. To send commands over physical Bluetooth/USB, build a release APK or EAS development client.
            </Text>
          </View>
        </View>
      )}

      {/* 2. Hero Status Card */}
      <View style={[styles.heroCard, connected ? styles.heroCardConnected : styles.heroCardDisconnected]}>
        <View style={styles.heroTopRow}>
          <View style={[styles.heroIconBox, connected ? styles.heroIconBoxConnected : styles.heroIconBoxDisconnected]}>
            <Ionicons name="print" size={26} color={connected ? "#15803d" : "#64748b"} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.heroStatusBadgeRow}>
              <View style={[styles.statusDot, connected ? styles.statusDotConnected : styles.statusDotDisconnected]} />
              <Text style={[styles.statusBadgeText, connected ? styles.statusBadgeTextConnected : styles.statusBadgeTextDisconnected]}>
                {connected ? "PRINTER READY & CONNECTED" : "NO PRINTER CONNECTED"}
              </Text>
            </View>
            <Text style={styles.heroTitle} numberOfLines={1}>
              {connected ? device?.name : "Offline POS Mode"}
            </Text>
            <Text style={styles.heroSubtitle}>
              {connected
                ? `Protocol: ${device?.connectionType?.toUpperCase() || "BLUETOOTH"} • ${device?.address || device?.mac}`
                : "Receipts will be rendered digitally until a thermal printer is paired."}
            </Text>
          </View>
        </View>

        <View style={styles.heroActionsRow}>
          <Pressable
            style={({ pressed }) => [styles.heroPrimaryBtn, pressed && { opacity: 0.85 }]}
            onPress={() => void onTestPrint()}
          >
            <Ionicons name="receipt-outline" size={16} color={Colors.white} />
            <Text style={styles.heroPrimaryBtnText}>
              {connected ? "Print Test Slip" : "Preview Test Slip"}
            </Text>
          </Pressable>

          {connected ? (
            <Pressable
              style={({ pressed }) => [styles.heroSecondaryBtn, pressed && { opacity: 0.7 }]}
              onPress={disconnectPrinter}
            >
              <Ionicons name="close-circle-outline" size={16} color={Colors.danger} />
              <Text style={styles.heroSecondaryBtnText}>Disconnect</Text>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.heroSecondaryBtn, pressed && { opacity: 0.7 }]}
              onPress={() => setShowPreviewModal(true)}
            >
              <Ionicons name="eye-outline" size={16} color={Colors.primaryBlue} />
              <Text style={[styles.heroSecondaryBtnText, { color: Colors.primaryBlue }]}>View Layout</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* 3. Paper Format & Spec Section */}
      <SectionCard>
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardHeaderLeft}>
            <View style={styles.cardHeaderIconWrap}>
              <Ionicons name="document-text-outline" size={18} color={Colors.primaryBlue} />
            </View>
            <View>
              <Text style={styles.sectionTitle}>Thermal Paper Specification</Text>
              <Text style={styles.sectionSub}>Calibrate font density & column character limits</Text>
            </View>
          </View>
        </View>

        <View style={styles.paperOptionsGrid}>
          {/* 58mm option */}
          <Pressable
            style={[styles.paperCard, paperSize === "58mm" && styles.paperCardSelected]}
            onPress={() => setPaperSize("58mm")}
          >
            <View style={styles.paperCardHeader}>
              <View style={[styles.paperRadio, paperSize === "58mm" && styles.paperRadioSelected]}>
                {paperSize === "58mm" && <View style={styles.paperRadioInner} />}
              </View>
              <Text style={[styles.paperSizeLabel, paperSize === "58mm" && styles.paperSizeLabelSelected]}>
                58mm (2-Inch)
              </Text>
            </View>
            <Text style={styles.paperBadge}>Mobile & Portable</Text>
            <View style={styles.paperSpecList}>
              <Text style={styles.paperSpecItem}>• 384 px width</Text>
              <Text style={styles.paperSpecItem}>• 32 chars / line</Text>
              <Text style={styles.paperSpecItem}>• Compact handheld POS</Text>
            </View>
          </Pressable>

          {/* 80mm option */}
          <Pressable
            style={[styles.paperCard, paperSize === "80mm" && styles.paperCardSelected]}
            onPress={() => setPaperSize("80mm")}
          >
            <View style={styles.paperCardHeader}>
              <View style={[styles.paperRadio, paperSize === "80mm" && styles.paperRadioSelected]}>
                {paperSize === "80mm" && <View style={styles.paperRadioInner} />}
              </View>
              <Text style={[styles.paperSizeLabel, paperSize === "80mm" && styles.paperSizeLabelSelected]}>
                80mm (3-Inch)
              </Text>
            </View>
            <Text style={styles.paperBadgeStandard}>Desktop Standard</Text>
            <View style={styles.paperSpecList}>
              <Text style={styles.paperSpecItem}>• 576 px width</Text>
              <Text style={styles.paperSpecItem}>• 48 chars / line</Text>
              <Text style={styles.paperSpecItem}>• Full counter register</Text>
            </View>
          </Pressable>
        </View>
      </SectionCard>

      {/* 4. Automation & Receipt Footer */}
      <SectionCard>
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardHeaderLeft}>
            <View style={styles.cardHeaderIconWrap}>
              <Ionicons name="options-outline" size={18} color={Colors.primaryBlue} />
            </View>
            <View>
              <Text style={styles.sectionTitle}>Printing Behavior & Rules</Text>
              <Text style={styles.sectionSub}>Automated actions when orders are completed</Text>
            </View>
          </View>
        </View>

        <View style={styles.settingsList}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1, paddingRight: Spacing.sm }}>
              <Text style={styles.settingLabel}>Auto-Print On Checkout</Text>
              <Text style={styles.settingDescription}>
                Dispatch receipt immediately when payment is confirmed in POS.
              </Text>
            </View>
            <Switch
              value={autoPrintReceipts}
              onValueChange={setAutoPrintReceipts}
              trackColor={{ false: "#e2e8f0", true: Colors.primaryBlue }}
              thumbColor={Colors.white}
            />
          </View>

          <View style={styles.settingDivider} />

          <View style={styles.settingRow}>
            <View style={{ flex: 1, paddingRight: Spacing.sm }}>
              <Text style={styles.settingLabel}>Auto-Cut Paper (GS V)</Text>
              <Text style={styles.settingDescription}>
                Send partial guillotine cutter pulse after feed line spacer.
              </Text>
            </View>
            <Switch
              value={autoCutPaper}
              onValueChange={setAutoCutPaper}
              trackColor={{ false: "#e2e8f0", true: Colors.primaryBlue }}
              thumbColor={Colors.white}
            />
          </View>

          <View style={styles.settingDivider} />

          {/* Footer Message Customization */}
          <View style={{ paddingTop: 4 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <Text style={styles.settingLabel}>Receipt Footer Note</Text>
              <Pressable
                onPress={() => {
                  if (editingFooter) {
                    setFooterMessage(footerDraft.trim());
                    setEditingFooter(false);
                  } else {
                    setFooterDraft(footerMessage);
                    setEditingFooter(true);
                  }
                }}
              >
                <Text style={styles.editActionText}>{editingFooter ? "Save" : "Edit Message"}</Text>
              </Pressable>
            </View>

            {editingFooter ? (
              <View style={styles.footerInputBox}>
                <TextInput
                  style={styles.footerInput}
                  value={footerDraft}
                  onChangeText={setFooterDraft}
                  placeholder="e.g. Thank you for your business!"
                  placeholderTextColor={Colors.textMuted}
                  maxLength={60}
                />
              </View>
            ) : (
              <Text style={styles.footerPreviewText}>
                "{footerMessage || "Thank you for your business!"}"
              </Text>
            )}
          </View>
        </View>
      </SectionCard>

      {/* 5. Device Discovery & Pairing Hub */}
      <SectionCard>
        {/* Tab Selector: Bluetooth vs Network */}
        <View style={styles.hubTabRow}>
          <Pressable
            style={[styles.hubTab, activeTab === "bluetooth" && styles.hubTabActive]}
            onPress={() => setActiveTab("bluetooth")}
          >
            <Ionicons
              name="bluetooth"
              size={16}
              color={activeTab === "bluetooth" ? Colors.primaryBlue : Colors.textMuted}
            />
            <Text style={[styles.hubTabText, activeTab === "bluetooth" && styles.hubTabTextActive]}>
              Bluetooth Thermal
            </Text>
          </Pressable>

          <Pressable
            style={[styles.hubTab, activeTab === "network" && styles.hubTabActive]}
            onPress={() => setActiveTab("network")}
          >
            <Ionicons
              name="wifi-outline"
              size={16}
              color={activeTab === "network" ? Colors.primaryBlue : Colors.textMuted}
            />
            <Text style={[styles.hubTabText, activeTab === "network" && styles.hubTabTextActive]}>
              Ethernet / Wi-Fi IP
            </Text>
          </Pressable>
        </View>

        {activeTab === "bluetooth" ? (
          <>
            <View style={styles.scanHeaderRow}>
              <View>
                <Text style={styles.scanTitle}>Discovered Hardware</Text>
                <Text style={styles.scanSub}>Turn on Bluetooth and set printer into pairing mode</Text>
              </View>

              <Pressable
                style={({ pressed }) => [styles.scanBtn, isFetching && { opacity: 0.65 }, pressed && { opacity: 0.8 }]}
                disabled={isFetching}
                onPress={() => void onScan()}
              >
                {isFetching ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Ionicons name="scan-outline" size={14} color={Colors.white} />
                )}
                <Text style={styles.scanBtnText}>{isFetching ? "Scanning..." : "Scan Devices"}</Text>
              </Pressable>
            </View>

            {isError ? <Text style={styles.error}>{toErrorMessage(error, "Bluetooth scan error.")}</Text> : null}

            <View style={styles.deviceList}>
              {devices.map((item) => {
                const isPaired = device?.address === item.address;
                const isConnecting = connectingId === item.id;

                return (
                  <Pressable
                    key={item.id}
                    style={({ pressed }) => [
                      styles.deviceCard,
                      isPaired && styles.deviceCardPaired,
                      pressed && { opacity: 0.8 },
                    ]}
                    disabled={isConnecting}
                    onPress={() => void connect(item)}
                  >
                    <View style={styles.deviceLeft}>
                      <View style={[styles.deviceIconWrap, isPaired && styles.deviceIconWrapPaired]}>
                        <Ionicons
                          name="print-outline"
                          size={20}
                          color={isPaired ? "#15803d" : Colors.primaryBlue}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={styles.deviceName}>{item.name}</Text>
                          {isPaired && (
                            <View style={styles.activeTag}>
                              <Text style={styles.activeTagText}>Active</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.deviceAddress}>
                          MAC: {item.mac || item.address} • {item.connectionType.toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.connectPill, isPaired && styles.connectPillPaired]}>
                      {isConnecting ? (
                        <ActivityIndicator size="small" color={Colors.white} />
                      ) : (
                        <Text style={[styles.connectPillText, isPaired && styles.connectPillTextPaired]}>
                          {isPaired ? "Connected" : "Pair & Use"}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}

              {!isFetching && devices.length === 0 ? (
                <View style={styles.emptyDeviceBox}>
                  <View style={styles.emptyIconCircle}>
                    <Ionicons name="bluetooth-outline" size={28} color={Colors.textMuted} />
                  </View>
                  <Text style={styles.emptyDeviceTitle}>No Bluetooth Printers Discovered</Text>
                  <Text style={styles.emptyDeviceSub}>
                    1. Ensure thermal printer power is ON{"\n"}
                    2. Long-press Feed/Pair to make it discoverable{"\n"}
                    3. Tap 'Scan Devices' above to find it
                  </Text>
                </View>
              ) : null}
            </View>
          </>
        ) : (
          <View style={styles.networkFormBox}>
            <Text style={styles.networkFormTitle}>Direct TCP/IP Socket Connection</Text>
            <Text style={styles.networkFormSub}>
              Connect network thermal printers via LAN Ethernet or Wi-Fi (Raw port 9100).
            </Text>

            <View style={styles.networkInputRow}>
              <View style={{ flex: 2 }}>
                <Text style={styles.inputLabel}>Printer IP Address</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="192.168.1.100"
                  placeholderTextColor={Colors.textMuted}
                  value={networkIp}
                  onChangeText={setNetworkIp}
                  keyboardType="numeric"
                  autoCapitalize="none"
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Port</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="9100"
                  placeholderTextColor={Colors.textMuted}
                  value={networkPort}
                  onChangeText={setNetworkPort}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [styles.networkSaveBtn, pressed && { opacity: 0.85 }]}
              onPress={connectNetworkPrinter}
            >
              <Ionicons name="checkmark-circle-outline" size={18} color={Colors.white} />
              <Text style={styles.networkSaveBtnText}>Set as Active Printer</Text>
            </Pressable>
          </View>
        )}
      </SectionCard>

      {/* 6. Live Interactive Receipt Preview Modal */}
      <Modal visible={showPreviewModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="receipt" size={20} color={Colors.primaryBlue} />
                <Text style={styles.modalTitle}>Thermal Receipt Preview</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.modalCloseBtn, pressed && { opacity: 0.7 }]}
                onPress={() => setShowPreviewModal(false)}
              >
                <Ionicons name="close" size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>

            <View style={styles.modalPaperSelector}>
              <Text style={styles.previewPaperNote}>
                Format: <Text style={{ fontWeight: "700", color: Colors.primaryBlue }}>{paperSize}</Text> (
                {paperSize === "58mm" ? "32 characters per row" : "48 characters per row"})
              </Text>
            </View>

            {/* Paper Simulation */}
            <View style={[styles.receiptPaper, paperSize === "58mm" ? styles.receiptPaper58 : styles.receiptPaper80]}>
              <View style={styles.receiptJaggedTop} />

              <Text style={styles.receiptStoreName}>{shopName || "OmniPOS Store"}</Text>
              <Text style={styles.receiptMeta}>TAX INVOICE / RECEIPT</Text>
              <Text style={styles.receiptMeta}>Date: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
              <Text style={styles.receiptMeta}>Receipt #: TEST-00084</Text>
              <Text style={styles.receiptMeta}>Cashier: Register 01</Text>

              <Text style={styles.receiptDashedLine}>- - - - - - - - - - - - - - - - - - - - - -</Text>

              <View style={styles.receiptRow}>
                <Text style={styles.receiptItemName}>2x Sample Item A</Text>
                <Text style={styles.receiptItemPrice}>{currency} 50.00</Text>
              </View>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptItemName}>1x Sample Item B</Text>
                <Text style={styles.receiptItemPrice}>{currency} 25.00</Text>
              </View>

              <Text style={styles.receiptDashedLine}>- - - - - - - - - - - - - - - - - - - - - -</Text>

              <View style={styles.receiptRow}>
                <Text style={styles.receiptSummaryLabel}>Subtotal</Text>
                <Text style={styles.receiptSummaryValue}>{currency} 75.00</Text>
              </View>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptSummaryLabel}>VAT / Tax ({taxRate}%)</Text>
                <Text style={styles.receiptSummaryValue}>{currency} {(75 * (taxRate / 100)).toFixed(2)}</Text>
              </View>

              <View style={[styles.receiptRow, { marginTop: 4 }]}>
                <Text style={styles.receiptTotalLabel}>TOTAL PAID</Text>
                <Text style={styles.receiptTotalValue}>
                  {currency} {(75 + 75 * (taxRate / 100)).toFixed(2)}
                </Text>
              </View>

              <Text style={styles.receiptDashedLine}>- - - - - - - - - - - - - - - - - - - - - -</Text>

              <Text style={styles.receiptFooterNote}>{footerMessage || "Thank you for your business!"}</Text>
              <Text style={styles.receiptBarcodeText}>||||| | |||| ||| ||||||| |||||</Text>

              <View style={styles.receiptJaggedBottom} />
            </View>

            <Pressable
              style={({ pressed }) => [styles.modalDoneBtn, pressed && { opacity: 0.85 }]}
              onPress={() => setShowPreviewModal(false)}
            >
              <Text style={styles.modalDoneBtnText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  /* Native Notice Banner */
  nativeNoticeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginBottom: Spacing.xs,
  },
  nativeNoticeIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#fef3c7",
    alignItems: "center",
    justifyContent: "center",
  },
  nativeNoticeTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  nativeNoticeTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#92400e",
  },
  emulatorBadge: {
    backgroundColor: "#fef3c7",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  emulatorBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#b45309",
  },
  nativeNoticeSub: {
    fontSize: 11.5,
    color: "#b45309",
    lineHeight: 16,
  },

  /* Hero Status Card */
  heroCard: {
    borderRadius: Radius.card,
    padding: Spacing.md,
    borderWidth: 1.5,
    gap: Spacing.md,
  },
  heroCardConnected: {
    backgroundColor: "#f0fdf4",
    borderColor: "#86efac",
  },
  heroCardDisconnected: {
    backgroundColor: "#f8fafc",
    borderColor: "#e2e8f0",
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  heroIconBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  heroIconBoxConnected: {
    backgroundColor: "#dcfce7",
  },
  heroIconBoxDisconnected: {
    backgroundColor: "#e2e8f0",
  },
  heroStatusBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotConnected: {
    backgroundColor: "#16a34a",
  },
  statusDotDisconnected: {
    backgroundColor: "#94a3b8",
  },
  statusBadgeText: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  statusBadgeTextConnected: {
    color: "#15803d",
  },
  statusBadgeTextDisconnected: {
    color: "#64748b",
  },
  heroTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  heroSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  heroActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingTop: 4,
  },
  heroPrimaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 10,
    borderRadius: Radius.pill,
  },
  heroPrimaryBtnText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: "700",
  },
  heroSecondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  heroSecondaryBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.danger,
  },

  /* Card Headers */
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  cardHeaderIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  sectionSub: {
    fontSize: 11.5,
    color: Colors.textMuted,
    marginTop: 1,
  },

  /* Paper Format Options Grid */
  paperOptionsGrid: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  paperCard: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    borderRadius: Radius.card,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    gap: 4,
  },
  paperCardSelected: {
    borderColor: Colors.primaryBlue,
    backgroundColor: "#f0f7ff",
  },
  paperCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  paperRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
  },
  paperRadioSelected: {
    borderColor: Colors.primaryBlue,
  },
  paperRadioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primaryBlue,
  },
  paperSizeLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  paperSizeLabelSelected: {
    color: Colors.primaryBlue,
    fontWeight: "800",
  },
  paperBadge: {
    alignSelf: "flex-start",
    fontSize: 10,
    fontWeight: "700",
    color: "#64748b",
    backgroundColor: "#e2e8f0",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 4,
  },
  paperBadgeStandard: {
    alignSelf: "flex-start",
    fontSize: 10,
    fontWeight: "700",
    color: Colors.primaryBlue,
    backgroundColor: Colors.primaryBluePale,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 4,
  },
  paperSpecList: {
    gap: 2,
  },
  paperSpecItem: {
    fontSize: 11,
    color: Colors.textMuted,
  },

  /* Printing Rules & Switches */
  settingsList: {
    gap: Spacing.sm,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  settingLabel: {
    fontSize: 13.5,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  settingDescription: {
    fontSize: 11.5,
    color: Colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  settingDivider: {
    height: 1,
    backgroundColor: "#f1f5f9",
    marginVertical: 2,
  },
  editActionText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  footerInputBox: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  footerInput: {
    fontSize: 12.5,
    color: Colors.textPrimary,
  },
  footerPreviewText: {
    fontSize: 12,
    fontStyle: "italic",
    color: Colors.textSecondary,
  },

  /* Hub Tabs */
  hubTabRow: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderRadius: Radius.input,
    padding: 3,
    marginBottom: Spacing.md,
  },
  hubTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 6,
  },
  hubTabActive: {
    backgroundColor: Colors.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  hubTabText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: Colors.textMuted,
  },
  hubTabTextActive: {
    color: Colors.primaryBlue,
    fontWeight: "800",
  },

  /* Bluetooth Discovery */
  scanHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  scanTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  scanSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.primaryBlue,
    paddingHorizontal: 12,
    paddingVertical: 7,
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
    marginTop: 4,
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
    borderColor: "#86efac",
    backgroundColor: "#f0fdf4",
  },
  deviceLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  deviceIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  deviceIconWrapPaired: {
    backgroundColor: "#dcfce7",
  },
  deviceName: {
    fontSize: 13.5,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  activeTag: {
    backgroundColor: "#dcfce7",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  activeTagText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#15803d",
  },
  deviceAddress: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  connectPill: {
    backgroundColor: Colors.primaryBlue,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    minWidth: 74,
    alignItems: "center",
  },
  connectPillPaired: {
    backgroundColor: "#16a34a",
  },
  connectPillText: {
    color: Colors.white,
    fontSize: 11.5,
    fontWeight: "700",
  },
  connectPillTextPaired: {
    color: Colors.white,
  },
  emptyDeviceBox: {
    alignItems: "center",
    paddingVertical: Spacing.lg,
    gap: 6,
  },
  emptyIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyDeviceTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginTop: 2,
  },
  emptyDeviceSub: {
    fontSize: 11.5,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 18,
  },

  /* Network Printer Form */
  networkFormBox: {
    gap: Spacing.sm,
  },
  networkFormTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  networkFormSub: {
    fontSize: 11.5,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  networkInputRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: 4,
  },
  inputLabel: {
    fontSize: 11.5,
    fontWeight: "600",
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  textInput: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  networkSaveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    marginTop: 4,
  },
  networkSaveBtnText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: "700",
  },

  /* Receipt Preview Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.md,
  },
  modalContainer: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    width: "100%",
    maxWidth: 380,
    padding: Spacing.md,
    gap: Spacing.md,
    maxHeight: "90%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  modalCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  modalPaperSelector: {
    backgroundColor: "#f0f7ff",
    padding: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  previewPaperNote: {
    fontSize: 11.5,
    color: Colors.textSecondary,
  },
  receiptPaper: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 6,
    padding: Spacing.md,
    alignSelf: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  receiptPaper58: {
    width: 230,
  },
  receiptPaper80: {
    width: 290,
  },
  receiptJaggedTop: {
    height: 3,
    backgroundColor: "#e2e8f0",
    marginBottom: 8,
    borderRadius: 2,
  },
  receiptJaggedBottom: {
    height: 3,
    backgroundColor: "#e2e8f0",
    marginTop: 10,
    borderRadius: 2,
  },
  receiptStoreName: {
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
    color: "#0f172a",
    textTransform: "uppercase",
  },
  receiptMeta: {
    fontSize: 10,
    textAlign: "center",
    color: "#475569",
    fontFamily: "monospace",
    marginTop: 1,
  },
  receiptDashedLine: {
    fontSize: 9,
    textAlign: "center",
    color: "#94a3b8",
    fontFamily: "monospace",
    marginVertical: 4,
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 1,
  },
  receiptItemName: {
    fontSize: 10.5,
    fontFamily: "monospace",
    color: "#0f172a",
  },
  receiptItemPrice: {
    fontSize: 10.5,
    fontFamily: "monospace",
    fontWeight: "700",
    color: "#0f172a",
  },
  receiptSummaryLabel: {
    fontSize: 10,
    fontFamily: "monospace",
    color: "#475569",
  },
  receiptSummaryValue: {
    fontSize: 10,
    fontFamily: "monospace",
    color: "#0f172a",
  },
  receiptTotalLabel: {
    fontSize: 11,
    fontFamily: "monospace",
    fontWeight: "800",
    color: "#0f172a",
  },
  receiptTotalValue: {
    fontSize: 11,
    fontFamily: "monospace",
    fontWeight: "900",
    color: "#0f172a",
  },
  receiptFooterNote: {
    fontSize: 9.5,
    fontStyle: "italic",
    textAlign: "center",
    color: "#475569",
    marginTop: 4,
  },
  receiptBarcodeText: {
    fontSize: 11,
    letterSpacing: 2,
    textAlign: "center",
    color: "#0f172a",
    marginTop: 4,
  },
  modalDoneBtn: {
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    alignItems: "center",
  },
  modalDoneBtnText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: "700",
  },
});
