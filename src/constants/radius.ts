import { ViewStyle } from "react-native";

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 50,
  card: 20,
  input: 14,
  badge: 50,
  modal: 24,
} as const satisfies Record<string, ViewStyle["borderRadius"]>;
