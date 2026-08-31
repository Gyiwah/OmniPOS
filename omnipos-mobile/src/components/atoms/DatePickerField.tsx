import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { DatePickerModal } from "./DatePickerModal";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

type DatePickerFieldProps = {
  label: string;
  value?: string | null; // "YYYY-MM-DD"
  onChange: (value: string | null) => void;
  placeholder?: string;
  helperText?: string;
  modalTitle?: string;
  style?: ViewStyle;
};

export function DatePickerField({
  label,
  value,
  onChange,
  placeholder = "Select date (YYYY-MM-DD)",
  helperText,
  modalTitle,
  style,
}: DatePickerFieldProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={styles.field}
        onPress={() => setModalOpen(true)}
        accessibilityRole="button"
      >
        <Ionicons name="calendar-outline" size={20} color={Colors.primaryBlue} />
        <Text style={[styles.valueText, !value && styles.placeholderText]}>
          {value ? value.slice(0, 10) : placeholder}
        </Text>
        {value ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            hitSlop={10}
            style={styles.clearIcon}
          >
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </Pressable>
        ) : (
          <Ionicons name="chevron-down" size={18} color={Colors.textMuted} />
        )}
      </Pressable>
      {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}

      <DatePickerModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={onChange}
        value={value}
        title={modalTitle || label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.xs,
  },
  label: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
    minHeight: 48,
  },
  valueText: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
    fontWeight: "500",
  },
  placeholderText: {
    color: Colors.textMuted,
    fontWeight: "400",
  },
  clearIcon: {
    padding: 2,
  },
  helperText: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontSize: 12,
  },
});
