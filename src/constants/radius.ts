import { ViewStyle } from "react-native";

export const Radius = {
  pill: 50,
  card: 20,
  input: 14,
  badge: 50,
  modal: 24,
} as const satisfies Record<string, ViewStyle["borderRadius"]>;
