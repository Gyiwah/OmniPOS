import * as Haptics from "expo-haptics";
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";

type Variant = "primary" | "outline" | "ghost";

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: Variant;
  fullWidth?: boolean;
  style?: ViewStyle;
};

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  variant = "primary",
  fullWidth = true,
  style,
}: PrimaryButtonProps) {
  async function handlePress() {
    if (disabled || loading) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  }

  const isPrimary = variant === "primary";

  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        variant === "primary" && styles.primaryBg,
        variant === "outline" && styles.outlineBg,
        variant === "ghost" && styles.ghostBg,
        pressed && variant === "primary" && { opacity: 0.92 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? Colors.textWhite : Colors.primaryBlue} />
      ) : (
        <Text
          style={[
            styles.label,
            variant === "primary" && styles.labelOnPrimary,
            variant === "outline" && styles.labelOutline,
            variant === "ghost" && styles.labelGhost,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.sm + 4,
    paddingHorizontal: Spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  fullWidth: {
    alignSelf: "stretch",
    width: "100%",
  },
  primaryBg: {
    backgroundColor: Colors.primaryBlue,
  },
  outlineBg: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primaryBlue,
  },
  ghostBg: {
    backgroundColor: "transparent",
  },
  label: {
    fontSize: 15,
    fontWeight: "700",
  },
  labelOnPrimary: {
    color: Colors.textWhite,
  },
  labelOutline: {
    color: Colors.primaryBlue,
  },
  labelGhost: {
    color: Colors.primaryBlue,
  },
});
