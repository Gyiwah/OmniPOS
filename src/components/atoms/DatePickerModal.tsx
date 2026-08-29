import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { Colors } from "@/src/constants/colors";
import { Elevation } from "@/src/constants/elevation";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

type DatePickerModalProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (dateStr: string | null) => void;
  value?: string | null; // "YYYY-MM-DD"
  title?: string;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function formatIso(year: number, monthIndex: number, day: number): string {
  const m = String(monthIndex + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

export function DatePickerModal({
  visible,
  onClose,
  onSelect,
  value,
  title = "Select Date",
}: DatePickerModalProps) {
  const initialDate = useMemo(() => {
    if (value && value.trim()) {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  }, [value]);

  const [currentYear, setCurrentYear] = useState(() => initialDate.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => initialDate.getMonth());
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(() => (value ? value.slice(0, 10) : null));

  React.useEffect(() => {
    if (visible) {
      if (value && value.trim()) {
        const parsed = new Date(value);
        if (!isNaN(parsed.getTime())) {
          setCurrentYear(parsed.getFullYear());
          setCurrentMonth(parsed.getMonth());
          setSelectedDateStr(value.slice(0, 10));
          return;
        }
      }
      const now = new Date();
      setCurrentYear(now.getFullYear());
      setCurrentMonth(now.getMonth());
      setSelectedDateStr(null);
    }
  }, [visible, value]);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const daysInMonth = useMemo(() => {
    return new Date(currentYear, currentMonth + 1, 0).getDate();
  }, [currentYear, currentMonth]);

  const firstDayOffset = useMemo(() => {
    return new Date(currentYear, currentMonth, 1).getDay();
  }, [currentYear, currentMonth]);

  const calendarCells = useMemo(() => {
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDayOffset; i++) {
      cells.push(null);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(d);
    }
    return cells;
  }, [daysInMonth, firstDayOffset]);

  function handlePrevMonth() {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  }

  function handleNextMonth() {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  }

  function applyPreset(daysToAdd: number) {
    const d = new Date();
    d.setDate(d.getDate() + daysToAdd);
    const iso = d.toISOString().slice(0, 10);
    setCurrentYear(d.getFullYear());
    setCurrentMonth(d.getMonth());
    setSelectedDateStr(iso);
  }

  function handleSave() {
    onSelect(selectedDateStr);
    onClose();
  }

  function handleClear() {
    setSelectedDateStr(null);
    onSelect(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.dialog}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>
                {selectedDateStr ? `Selected: ${selectedDateStr}` : "No date selected"}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={Colors.textSecondary} />
            </Pressable>
          </View>

          {/* Quick Presets */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.presetsRow}
          >
            <Pressable style={styles.presetChip} onPress={() => applyPreset(30)}>
              <Text style={styles.presetText}>+30 Days</Text>
            </Pressable>
            <Pressable style={styles.presetChip} onPress={() => applyPreset(90)}>
              <Text style={styles.presetText}>+3 Months</Text>
            </Pressable>
            <Pressable style={styles.presetChip} onPress={() => applyPreset(180)}>
              <Text style={styles.presetText}>+6 Months</Text>
            </Pressable>
            <Pressable style={styles.presetChip} onPress={() => applyPreset(365)}>
              <Text style={styles.presetText}>+1 Year</Text>
            </Pressable>
            <Pressable style={styles.presetChip} onPress={() => applyPreset(0)}>
              <Text style={styles.presetText}>Today</Text>
            </Pressable>
          </ScrollView>

          {/* Month / Year Navigator */}
          <View style={styles.navRow}>
            <Pressable onPress={handlePrevMonth} style={styles.navBtn} hitSlop={10}>
              <Ionicons name="chevron-back" size={20} color={Colors.primaryBlue} />
            </Pressable>
            <Text style={styles.monthLabel}>
              {MONTH_NAMES[currentMonth]} {currentYear}
            </Text>
            <Pressable onPress={handleNextMonth} style={styles.navBtn} hitSlop={10}>
              <Ionicons name="chevron-forward" size={20} color={Colors.primaryBlue} />
            </Pressable>
          </View>

          {/* Weekday Headers */}
          <View style={styles.weekdaysRow}>
            {WEEKDAYS.map((wd) => (
              <Text key={wd} style={styles.weekdayText}>
                {wd}
              </Text>
            ))}
          </View>

          {/* Calendar Grid */}
          <View style={styles.grid}>
            {calendarCells.map((day, idx) => {
              if (day === null) {
                return <View key={`empty-${idx}`} style={styles.dayCell} />;
              }

              const cellIso = formatIso(currentYear, currentMonth, day);
              const isSelected = selectedDateStr === cellIso;
              const isToday = todayStr === cellIso;

              return (
                <Pressable
                  key={`day-${cellIso}`}
                  style={[
                    styles.dayCell,
                    isSelected && styles.dayCellSelected,
                    isToday && !isSelected && styles.dayCellToday,
                  ]}
                  onPress={() => setSelectedDateStr(cellIso)}
                >
                  <Text
                    style={[
                      styles.dayText,
                      isSelected && styles.dayTextSelected,
                      isToday && !isSelected && styles.dayTextToday,
                    ]}
                  >
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Actions */}
          <View style={styles.footer}>
            <Pressable onPress={handleClear} style={styles.clearBtn}>
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
            <View style={styles.footerRight}>
              <PrimaryButton
                label="Cancel"
                variant="outline"
                fullWidth={false}
                style={styles.cancelBtn}
                onPress={onClose}
              />
              <PrimaryButton
                label="Confirm Date"
                variant="primary"
                fullWidth={false}
                style={styles.confirmBtn}
                onPress={handleSave}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.md,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  dialog: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Elevation.card,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  title: {
    ...Typography.title,
    color: Colors.textPrimary,
    fontSize: 18,
  },
  subtitle: {
    ...Typography.caption,
    color: Colors.primaryBlue,
    fontWeight: "600",
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
  },
  presetsRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  presetChip: {
    backgroundColor: Colors.primaryBluePale,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  presetText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
  },
  navBtn: {
    padding: Spacing.xs,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
  },
  monthLabel: {
    ...Typography.body,
    fontWeight: "700",
    color: Colors.textPrimary,
    fontSize: 16,
  },
  weekdaysRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  weekdayText: {
    width: 38,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textMuted,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  dayCell: {
    width: `${100 / 7}%`,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.pill,
    marginVertical: 2,
  },
  dayCellSelected: {
    backgroundColor: Colors.primaryBlue,
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: Colors.primaryBlue,
  },
  dayText: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: "500",
  },
  dayTextSelected: {
    color: Colors.textWhite,
    fontWeight: "700",
  },
  dayTextToday: {
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
  },
  clearBtn: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  clearText: {
    fontSize: 14,
    color: Colors.accentOrange,
    fontWeight: "600",
  },
  footerRight: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  cancelBtn: {
    minHeight: 38,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  confirmBtn: {
    minHeight: 38,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
});
