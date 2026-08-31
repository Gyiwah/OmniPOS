import { ReactNode, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  TextInputProps as RNTextInputProps,
  View,
  ViewStyle,
} from "react-native";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";

export type OmniTextInputProps = {
  label?: string;
  error?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  containerStyle?: ViewStyle;
} & RNTextInputProps;

export function TextInput({
  label,
  error,
  leftIcon,
  rightIcon,
  containerStyle,
  style,
  onFocus,
  onBlur,
  ...rest
}: OmniTextInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.wrap, containerStyle]}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.field, focused && styles.fieldFocused, !!error && styles.fieldError]}>
        {!!leftIcon && <View style={styles.icon}>{leftIcon}</View>}
        <RNTextInput
          placeholderTextColor={Colors.textMuted}
          {...rest}
          style={[styles.input, style]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
        />
        {!!rightIcon && <View style={styles.icon}>{rightIcon}</View>}
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.xs,
    width: "100%",
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.sm,
    minHeight: 48,
  },
  fieldFocused: {
    borderColor: Colors.primaryBlue,
  },
  fieldError: {
    borderColor: Colors.danger,
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.sm,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  icon: {
    marginHorizontal: Spacing.xs,
    justifyContent: "center",
  },
  error: {
    fontSize: 12,
    color: Colors.danger,
  },
});
