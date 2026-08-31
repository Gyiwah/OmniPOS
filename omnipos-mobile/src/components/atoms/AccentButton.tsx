import * as Haptics from "expo-haptics";
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from "react-native";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";

type AccentButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  outlined?: boolean;
  style?: ViewStyle;
};

export function AccentButton({
  label,
  onPress,
  loading,
  disabled,
  fullWidth = true,
  outlined = false,
  style,
}: AccentButtonProps) {
  async function handlePress() {
    if (disabled || loading) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        outlined ? styles.outline : styles.solid,
        pressed && { opacity: 0.92 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={outlined ? Colors.accentOrange : Colors.textWhite} />
      ) : (
        <Text style={[styles.label, outlined && styles.labelOutlined]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  fullWidth: {
    alignSelf: "stretch",
    width: "100%",
  },
  solid: {
    backgroundColor: Colors.accentOrange,
  },
  outline: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Colors.accentOrange,
  },
  label: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textWhite,
  },
  labelOutlined: {
    color: Colors.accentOrange,
  },
});
