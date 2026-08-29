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

import { Colors } from "@/src/constants/colors";
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
            <View style={styles.headerLeft}>
              <View style={styles.calendarIconWrap}>
                <Ionicons name="calendar" size={20} color={Colors.primaryBlue} />
              </View>
              <View>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.subtitle}>
                  {selectedDateStr ? `Selected: ${selectedDateStr}` : "Tap a date below"}
                </Text>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={Colors.textMuted} />
            </Pressable>
          </View>

          {/* Quick Presets */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.presetsRow}
          >
            <Pressable style={styles.presetChip} onPress={() => applyPreset(0)}>
              <Text style={styles.presetText}>Today</Text>
            </Pressable>
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

          {/* Actions Footer */}
          <View style={styles.footer}>
            <Pressable onPress={handleClear} style={styles.clearBtn}>
              <Ionicons name="trash-outline" size={16} color={Colors.textMuted} />
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>

            <View style={styles.footerRight}>
              <Pressable style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.saveBtn} onPress={handleSave}>
                <Ionicons name="checkmark" size={16} color={Colors.white} />
                <Text style={styles.saveBtnText}>Apply</Text>
              </Pressable>
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
    backgroundColor: "rgba(15, 23, 42, 0.6)",
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    paddingBottom: Spacing.sm,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  calendarIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  presetsRow: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 4,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  presetText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  navBtn: {
    padding: 6,
  },
  monthLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  weekdaysRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 4,
  },
  weekdayText: {
    width: 36,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "700",
    color: Colors.textMuted,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  dayCell: {
    width: "14.28%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.pill,
    marginVertical: 1,
  },
  dayCellSelected: {
    backgroundColor: Colors.primaryBlue,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  dayCellToday: {
    borderWidth: 1.5,
    borderColor: Colors.primaryBlue,
  },
  dayText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  dayTextSelected: {
    color: Colors.white,
    fontWeight: "800",
  },
  dayTextToday: {
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingTop: Spacing.sm,
    marginTop: 4,
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  clearText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: "600",
  },
  footerRight: {
    flexDirection: "row",
    gap: 8,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryBlue,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: Colors.white,
  },
});
