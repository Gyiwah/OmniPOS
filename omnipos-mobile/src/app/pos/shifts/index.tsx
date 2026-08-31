import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";

import { AppScrollScreen } from "@/src/components/layout/AppScrollScreen";
import { TextInput } from "@/src/components/atoms/TextInput";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { useStoreSlice } from "@/src/store/storeSlice";
import { useActiveShift, useShiftMutations, useShiftSummary } from "@/src/features/shifts/hooks";
import { shiftsService } from "@/src/features/shifts/service";
import type { ShiftRecord } from "@/src/features/shifts/types";
import { toErrorMessage } from "@/src/utils/errors";
import { useSettingsStore } from "@/src/store/settingsStore";

export default function RegisterShiftsScreen() {
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const { currency } = useSettingsStore();
  const sym = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";

  const { data: activeShift, isLoading: isShiftLoading, refetch: refetchActive } = useActiveShift();
  const { data: summary, refetch: refetchSummary } = useShiftSummary(activeShift?.id);
  const { openShift, recordMovement, closeShift, isOpenLoading, isMovementLoading, isCloseLoading } =
    useShiftMutations();

  const [pastShifts, setPastShifts] = useState<ShiftRecord[]>([]);

  // Modals state
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openingFloat, setOpeningFloat] = useState("100");
  const [openNotes, setOpenNotes] = useState("");

  const [showMovementModal, setShowMovementModal] = useState(false);
  const [movementType, setMovementType] = useState<"in" | "out">("in");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");

  const [showCloseModal, setShowCloseModal] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");

  const [reportModalData, setReportModalData] = useState<{ title: string; text: string } | null>(null);

  const loadPastShifts = useCallback(async () => {
    if (!activeStoreId) return;
    const list = await shiftsService.list(activeStoreId);
    setPastShifts(list.filter((s) => s.status === "closed").slice(0, 10));
  }, [activeStoreId]);

  useFocusEffect(
    useCallback(() => {
      void refetchActive();
      void refetchSummary();
      void loadPastShifts();
    }, [refetchActive, refetchSummary, loadPastShifts]),
  );

  async function handleOpenShift() {
    const floatNum = Number(openingFloat);
    if (isNaN(floatNum) || floatNum < 0) {
      Alert.alert("Invalid Float", "Please enter a valid opening float amount.");
      return;
    }

    try {
      await openShift({ openingFloat: floatNum, notes: openNotes.trim() });
      setShowOpenModal(false);
      void refetchActive();
      void refetchSummary();
      Alert.alert("Shift Opened", `Cash drawer opened with starting float ${sym} ${floatNum.toFixed(2)}.`);
    } catch (err) {
      Alert.alert("Error", toErrorMessage(err, "Failed to open shift."));
    }
  }

  async function handleRecordMovement() {
    const amt = Number(movementAmount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert("Invalid Amount", "Please enter an amount greater than 0.");
      return;
    }
    if (!movementReason.trim()) {
      Alert.alert("Reason Required", "Please specify a reason for this cash movement.");
      return;
    }
    if (!activeShift) return;

    try {
      await recordMovement({
        shiftId: activeShift.id,
        type: movementType,
        amount: amt,
        reason: movementReason.trim(),
      });
      setShowMovementModal(false);
      setMovementAmount("");
      setMovementReason("");
      void refetchActive();
      void refetchSummary();
      Alert.alert(
        "Movement Recorded",
        `${movementType === "in" ? "Cash In" : "Cash Out"} of ${sym} ${amt.toFixed(2)} recorded in drawer.`,
      );
    } catch (err) {
      Alert.alert("Error", toErrorMessage(err, "Failed to record cash movement."));
    }
  }

  async function handleCloseShift() {
    const counted = Number(countedCash);
    if (isNaN(counted) || counted < 0) {
      Alert.alert("Invalid Amount", "Please enter the physical cash count.");
      return;
    }
    if (!activeShift) return;

    try {
      const closed = await closeShift({
        shiftId: activeShift.id,
        actualCash: counted,
        notes: closeNotes.trim(),
      });

      const zReport = await shiftsService.generateZReport(activeShift.id, "OmniPOS Store", "Cashier");
      setShowCloseModal(false);
      void refetchActive();
      void loadPastShifts();

      const discrepancy = closed.discrepancy ?? 0;
      const diffText =
        Math.abs(discrepancy) < 0.01
          ? "Exact Match (Balanced)"
          : discrepancy > 0
            ? `Cash Over: +${sym} ${discrepancy.toFixed(2)}`
            : `Cash Short: -${sym} ${Math.abs(discrepancy).toFixed(2)}`;

      const reportText = `
========================================
           Z-REPORT / SHIFT SUMMARY
========================================
Store: ${zReport.storeName}
Date: ${new Date().toLocaleString()}
Status: CLOSED

--- CASH DRAWER RECONCILIATION ---
Opening Float:        ${sym} ${zReport.shift.openingFloat.toFixed(2)}
Cash Sales:          +${sym} ${zReport.cashSales.toFixed(2)}
Cash In (Paid In):   +${sym} ${zReport.shift.cashIn.toFixed(2)}
Cash Out (Paid Out): -${sym} ${zReport.shift.cashOut.toFixed(2)}
----------------------------------------
EXPECTED CASH:        ${sym} ${zReport.netCashExpected.toFixed(2)}
ACTUAL COUNTED:       ${sym} ${counted.toFixed(2)}
DISCREPANCY:          ${diffText}
----------------------------------------

--- TOTAL SALES BREAKDOWN ---
Total Orders:         ${zReport.totalOrders}
Cash Sales:           ${sym} ${zReport.cashSales.toFixed(2)}
Card Sales:           ${sym} ${zReport.cardSales.toFixed(2)}
Mobile Money:         ${sym} ${zReport.momoSales.toFixed(2)}
Total Gross Revenue:  ${sym} ${zReport.totalSales.toFixed(2)}
Discounts Applied:    ${sym} ${zReport.totalDiscounts.toFixed(2)}
Tax Collected:        ${sym} ${zReport.totalTax.toFixed(2)}
========================================
`;

      setReportModalData({ title: "End of Shift Z-Report", text: reportText });
    } catch (err) {
      Alert.alert("Error", toErrorMessage(err, "Failed to close shift."));
    }
  }

  function handlePrintXReport() {
    if (!summary) return;
    const xReportText = `
========================================
           X-REPORT (MID-SHIFT)
========================================
Date: ${new Date().toLocaleString()}
Status: IN PROGRESS (OPEN)

--- DRAWER STATUS ---
Opening Float:        ${sym} ${summary.shift.openingFloat.toFixed(2)}
Cash Sales to Date:  +${sym} ${summary.cashSales.toFixed(2)}
Cash In:             +${sym} ${summary.shift.cashIn.toFixed(2)}
Cash Out:            -${sym} ${summary.shift.cashOut.toFixed(2)}
----------------------------------------
CURRENT EXPECTED:     ${sym} ${summary.netCashExpected.toFixed(2)}
----------------------------------------

--- REVENUE SUMMARY ---
Total Orders:         ${summary.totalOrders}
Cash Sales:           ${sym} ${summary.cashSales.toFixed(2)}
Card Sales:           ${sym} ${summary.cardSales.toFixed(2)}
Mobile Money:         ${sym} ${summary.momoSales.toFixed(2)}
Gross Sales:          ${sym} ${summary.totalSales.toFixed(2)}
========================================
`;
    setReportModalData({ title: "Mid-Shift X-Report Reading", text: xReportText });
  }

  const expectedDrawer = summary?.netCashExpected ?? activeShift?.expectedCash ?? 0;

  return (
    <AppScrollScreen
      showBack
      title="Register & Shifts"
      subtitle="Cash drawer balancing, paid-in/out, and Z-Reports"
    >
      {isShiftLoading ? (
        <View style={styles.centerLoading}>
          <ActivityIndicator size="large" color={Colors.primaryBlue} />
        </View>
      ) : activeShift ? (
        /* ACTIVE SHIFT VIEW */
        <View style={styles.contentWrap}>
          {/* Shift Status Header Card */}
          <View style={styles.activeShiftCard}>
            <View style={styles.shiftHeaderRow}>
              <View style={styles.statusPillOpen}>
                <View style={styles.pulsingDot} />
                <Text style={styles.statusPillTextOpen}>Drawer Open</Text>
              </View>
              <Text style={styles.shiftTime}>
                Opened {new Date(activeShift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </Text>
            </View>

            <View style={styles.drawerBalanceBox}>
              <Text style={styles.drawerBalanceLabel}>EXPECTED CASH IN DRAWER</Text>
              <Text style={styles.drawerBalanceValue}>
                {sym} {expectedDrawer.toFixed(2)}
              </Text>
            </View>

            {/* Shift Metrics Grid */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Opening Float</Text>
                <Text style={styles.metricVal}>
                  {sym} {activeShift.openingFloat.toFixed(2)}
                </Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Cash Sales</Text>
                <Text style={[styles.metricVal, { color: Colors.success }]}>
                  +{sym} {(summary?.cashSales ?? activeShift.cashSales).toFixed(2)}
                </Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Paid In (Cash In)</Text>
                <Text style={[styles.metricVal, { color: Colors.primaryBlue }]}>
                  +{sym} {activeShift.cashIn.toFixed(2)}
                </Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Paid Out (Cash Out)</Text>
                <Text style={[styles.metricVal, { color: Colors.danger }]}>
                  -{sym} {activeShift.cashOut.toFixed(2)}
                </Text>
              </View>
            </View>
          </View>

          {/* Action Buttons Row */}
          <View style={styles.actionsRow}>
            <Pressable
              style={[styles.actionBtn, { backgroundColor: Colors.primaryBluePale, borderColor: Colors.primaryBlue }]}
              onPress={() => {
                setMovementType("in");
                setShowMovementModal(true);
              }}
            >
              <Ionicons name="arrow-down-circle-outline" size={20} color={Colors.primaryBlue} />
              <Text style={[styles.actionBtnText, { color: Colors.primaryBlue }]}>Cash In</Text>
            </Pressable>

            <Pressable
              style={[styles.actionBtn, { backgroundColor: "#fee2e2", borderColor: "#fca5a5" }]}
              onPress={() => {
                setMovementType("out");
                setShowMovementModal(true);
              }}
            >
              <Ionicons name="arrow-up-circle-outline" size={20} color={Colors.danger} />
              <Text style={[styles.actionBtnText, { color: Colors.danger }]}>Cash Out</Text>
            </Pressable>

            <Pressable
              style={[styles.actionBtn, { backgroundColor: "#fef3c7", borderColor: "#fcd34d" }]}
              onPress={handlePrintXReport}
            >
              <Ionicons name="receipt-outline" size={20} color="#d97706" />
              <Text style={[styles.actionBtnText, { color: "#d97706" }]}>X-Report</Text>
            </Pressable>
          </View>

          {/* End Shift / Close Register Button */}
          <Pressable style={styles.closeShiftBtn} onPress={() => setShowCloseModal(true)}>
            <Ionicons name="lock-closed-outline" size={20} color={Colors.white} />
            <Text style={styles.closeShiftBtnText}>End Shift & Generate Z-Report</Text>
          </Pressable>

          {/* Cash Movements Log */}
          <View style={styles.sectionWrap}>
            <Text style={styles.sectionTitle}>Shift Cash Movements ({activeShift.movements.length})</Text>
            {activeShift.movements.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No cash in/out entries recorded in this shift yet.</Text>
              </View>
            ) : (
              activeShift.movements.map((m) => (
                <View key={m.id} style={styles.movementRow}>
                  <View
                    style={[
                      styles.movementIconWrap,
                      { backgroundColor: m.type === "in" ? "#ecfdf5" : "#fef2f2" },
                    ]}
                  >
                    <Ionicons
                      name={m.type === "in" ? "arrow-down" : "arrow-up"}
                      size={16}
                      color={m.type === "in" ? Colors.success : Colors.danger}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.movementReason}>{m.reason}</Text>
                    <Text style={styles.movementTime}>
                      {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.movementAmount,
                      { color: m.type === "in" ? Colors.success : Colors.danger },
                    ]}
                  >
                    {m.type === "in" ? "+" : "-"}
                    {sym} {m.amount.toFixed(2)}
                  </Text>
                </View>
              ))
            )}
          </View>
        </View>
      ) : (
        /* NO ACTIVE SHIFT VIEW */
        <View style={styles.noShiftWrap}>
          <View style={styles.noShiftHero}>
            <View style={styles.noShiftIconBox}>
              <Ionicons name="cash-outline" size={48} color={Colors.primaryBlue} />
            </View>
            <Text style={styles.noShiftTitle}>Cash Register is Closed</Text>
            <Text style={styles.noShiftSub}>
              Open a shift by counting your starting cash float to begin processing cash sales and tracking drawer balances.
            </Text>
          </View>

          <Pressable style={styles.openShiftPrimaryBtn} onPress={() => setShowOpenModal(true)}>
            <Ionicons name="key-outline" size={20} color={Colors.white} />
            <Text style={styles.openShiftPrimaryText}>Open Register Shift</Text>
          </Pressable>
        </View>
      )}

      {/* Past Closed Shifts History */}
      {pastShifts.length > 0 && (
        <View style={styles.sectionWrap}>
          <Text style={styles.sectionTitle}>Recent Closed Shifts</Text>
          {pastShifts.map((s) => (
            <View key={s.id} style={styles.historyCard}>
              <View style={styles.historyTopRow}>
                <Text style={styles.historyDate}>
                  {new Date(s.openedAt).toLocaleDateString()} at{" "}
                  {new Date(s.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </Text>
                <View
                  style={[
                    styles.diffBadge,
                    {
                      backgroundColor:
                        Math.abs(s.discrepancy ?? 0) < 0.01
                          ? "#ecfdf5"
                          : (s.discrepancy ?? 0) > 0
                            ? Colors.primaryBluePale
                            : "#fef2f2",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.diffBadgeText,
                      {
                        color:
                          Math.abs(s.discrepancy ?? 0) < 0.01
                            ? Colors.success
                            : (s.discrepancy ?? 0) > 0
                              ? Colors.primaryBlue
                              : Colors.danger,
                      },
                    ]}
                  >
                    {Math.abs(s.discrepancy ?? 0) < 0.01
                      ? "Balanced"
                      : (s.discrepancy ?? 0) > 0
                        ? `+${sym}${(s.discrepancy ?? 0).toFixed(2)}`
                        : `-${sym}${Math.abs(s.discrepancy ?? 0).toFixed(2)}`}
                  </Text>
                </View>
              </View>

              <View style={styles.historyBottomRow}>
                <Text style={styles.historySub}>
                  Float: {sym}{s.openingFloat.toFixed(2)} • Sales: {sym}{s.cashSales.toFixed(2)} • Counted: {sym}
                  {(s.actualCash ?? 0).toFixed(2)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* OPEN SHIFT MODAL */}
      <Modal visible={showOpenModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Open Register Shift</Text>
            <Text style={styles.modalSub}>Count the physical cash in your drawer before starting sales.</Text>

            <TextInput
              label={`Starting Float Amount (${sym}) *`}
              placeholder="0.00"
              keyboardType="numeric"
              value={openingFloat}
              onChangeText={setOpeningFloat}
            />

            {/* Quick Float Chips */}
            <View style={styles.quickChipsRow}>
              {[50, 100, 200, 500].map((val) => (
                <Pressable
                  key={val}
                  style={styles.quickChip}
                  onPress={() => setOpeningFloat(val.toString())}
                >
                  <Text style={styles.quickChipText}>{sym} {val}</Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              label="Shift Notes (Optional)"
              placeholder="e.g. Morning Shift Register 1"
              value={openNotes}
              onChangeText={setOpenNotes}
            />

            <View style={styles.modalBtnRow}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowOpenModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmBtn, isOpenLoading && { opacity: 0.7 }]}
                disabled={isOpenLoading}
                onPress={handleOpenShift}
              >
                {isOpenLoading ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.confirmBtnText}>Open Shift</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* CASH MOVEMENT MODAL */}
      <Modal visible={showMovementModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {movementType === "in" ? "Record Cash In (Paid In)" : "Record Cash Out (Paid Out)"}
            </Text>
            <Text style={styles.modalSub}>
              {movementType === "in"
                ? "Add cash to drawer (e.g. change float or cash injection)."
                : "Remove cash from drawer for expenses, vendor payouts, or safe drops."}
            </Text>

            <TextInput
              label={`Amount (${sym}) *`}
              placeholder="0.00"
              keyboardType="numeric"
              value={movementAmount}
              onChangeText={setMovementAmount}
            />

            {/* Quick Reasons */}
            <View style={styles.quickChipsRow}>
              {(movementType === "in"
                ? ["Bank change", "Float top-up", "Owner deposit"]
                : ["Petty cash expense", "Vendor payout", "Safe drop", "Owner withdrawal"]
              ).map((reason) => (
                <Pressable
                  key={reason}
                  style={styles.quickChip}
                  onPress={() => setMovementReason(reason)}
                >
                  <Text style={styles.quickChipText}>{reason}</Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              label="Reason Description *"
              placeholder="Describe the reason for this cash movement"
              value={movementReason}
              onChangeText={setMovementReason}
            />

            <View style={styles.modalBtnRow}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowMovementModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.confirmBtn,
                  movementType === "out" && { backgroundColor: Colors.danger },
                  isMovementLoading && { opacity: 0.7 },
                ]}
                disabled={isMovementLoading}
                onPress={handleRecordMovement}
              >
                {isMovementLoading ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.confirmBtnText}>Save Movement</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* CLOSE SHIFT MODAL */}
      <Modal visible={showCloseModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Close Register Shift</Text>
            <Text style={styles.modalSub}>
              Perform a physical cash count. Expected in drawer: {sym} {expectedDrawer.toFixed(2)}
            </Text>

            <TextInput
              label={`Actual Physical Cash Count (${sym}) *`}
              placeholder="0.00"
              keyboardType="numeric"
              value={countedCash}
              onChangeText={setCountedCash}
            />

            {/* Live Discrepancy Preview */}
            {countedCash.trim() !== "" && !isNaN(Number(countedCash)) && (
              <View
                style={[
                  styles.discrepancyBox,
                  {
                    backgroundColor:
                      Math.abs(Number(countedCash) - expectedDrawer) < 0.01
                        ? "#ecfdf5"
                        : Number(countedCash) > expectedDrawer
                          ? Colors.primaryBluePale
                          : "#fef2f2",
                    borderColor:
                      Math.abs(Number(countedCash) - expectedDrawer) < 0.01
                        ? "#bbf7d0"
                        : Number(countedCash) > expectedDrawer
                          ? "#bfdbfe"
                          : "#fecaca",
                  },
                ]}
              >
                <Ionicons
                  name={
                    Math.abs(Number(countedCash) - expectedDrawer) < 0.01
                      ? "checkmark-circle"
                      : "alert-circle"
                  }
                  size={18}
                  color={
                    Math.abs(Number(countedCash) - expectedDrawer) < 0.01
                      ? Colors.success
                      : Number(countedCash) > expectedDrawer
                        ? Colors.primaryBlue
                        : Colors.danger
                  }
                />
                <Text
                  style={[
                    styles.discrepancyText,
                    {
                      color:
                        Math.abs(Number(countedCash) - expectedDrawer) < 0.01
                          ? Colors.success
                          : Number(countedCash) > expectedDrawer
                            ? Colors.primaryBlue
                            : Colors.danger,
                    },
                  ]}
                >
                  {Math.abs(Number(countedCash) - expectedDrawer) < 0.01
                    ? "Drawer is perfectly balanced!"
                    : Number(countedCash) > expectedDrawer
                      ? `Cash Over by +${sym}${(Number(countedCash) - expectedDrawer).toFixed(2)}`
                      : `Cash Short by -${sym}${Math.abs(Number(countedCash) - expectedDrawer).toFixed(2)}`}
                </Text>
              </View>
            )}

            <TextInput
              label="Closing Notes (Optional)"
              placeholder="e.g. End of day reconciliation"
              value={closeNotes}
              onChangeText={setCloseNotes}
            />

            <View style={styles.modalBtnRow}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowCloseModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmBtn, isCloseLoading && { opacity: 0.7 }]}
                disabled={isCloseLoading}
                onPress={handleCloseShift}
              >
                {isCloseLoading ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.confirmBtnText}>Finalize Z-Report</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* REPORT DISPLAY MODAL */}
      <Modal visible={Boolean(reportModalData)} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: "85%" }]}>
            <Text style={styles.modalTitle}>{reportModalData?.title}</Text>
            <ScrollView style={styles.reportScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.receiptMonoText}>{reportModalData?.text}</Text>
            </ScrollView>

            <Pressable style={styles.printDoneBtn} onPress={() => setReportModalData(null)}>
              <Text style={styles.printDoneBtnText}>Close & Return</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  centerLoading: {
    paddingVertical: 60,
    alignItems: "center",
  },
  contentWrap: {
    gap: Spacing.lg,
  },
  activeShiftCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    gap: Spacing.md,
  },
  shiftHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusPillOpen: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#ecfdf5",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  statusPillTextOpen: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.success,
  },
  shiftTime: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "400",
  },
  drawerBalanceBox: {
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(7, 103, 222, 0.15)",
  },
  drawerBalanceLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primaryBlue,
    letterSpacing: 0.8,
  },
  drawerBalanceValue: {
    fontSize: 28,
    fontWeight: "800",
    color: Colors.navy,
    marginTop: 4,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  metricItem: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: Colors.background,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  metricLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: "600",
  },
  metricVal: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  closeShiftBtn: {
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 14,
    borderRadius: Radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  closeShiftBtnText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: "700",
  },
  sectionWrap: {
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  emptyCard: {
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "400",
  },
  movementRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  movementIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  movementReason: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  movementTime: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: "400",
  },
  movementAmount: {
    fontSize: 15,
    fontWeight: "700",
  },
  noShiftWrap: {
    backgroundColor: Colors.surface,
    padding: Spacing.xl,
    borderRadius: Radius.xl,
    alignItems: "center",
    gap: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  noShiftHero: {
    alignItems: "center",
    gap: Spacing.sm,
  },
  noShiftIconBox: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  noShiftTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  noShiftSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
    fontWeight: "400",
  },
  openShiftPrimaryBtn: {
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 14,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  openShiftPrimaryText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: "700",
  },
  historyCard: {
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  historyTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  historyDate: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  diffBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  diffBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  historyBottomRow: {
    flexDirection: "row",
  },
  historySub: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "400",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(4, 35, 88, 0.45)",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  modalSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: "400",
    lineHeight: 18,
  },
  quickChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  quickChip: {
    backgroundColor: Colors.background,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quickChipText: {
    fontSize: 12,
    color: Colors.textPrimary,
    fontWeight: "600",
  },
  discrepancyBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  discrepancyText: {
    fontSize: 13,
    fontWeight: "700",
  },
  modalBtnRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Radius.lg,
    alignItems: "center",
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: {
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Radius.lg,
    alignItems: "center",
    backgroundColor: Colors.primaryBlue,
  },
  confirmBtnText: {
    color: Colors.white,
    fontWeight: "700",
  },
  reportScroll: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing.md,
    maxHeight: 380,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  receiptMonoText: {
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    fontSize: 12,
    color: Colors.textPrimary,
    lineHeight: 18,
  },
  printDoneBtn: {
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 12,
    borderRadius: Radius.lg,
    alignItems: "center",
  },
  printDoneBtnText: {
    color: Colors.white,
    fontWeight: "700",
    fontSize: 14,
  },
});
