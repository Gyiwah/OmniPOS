import { ViewStyle } from "react-native";

/** Soft shadows matching design system (approximate CSS box-shadow in RN) */
export const Elevation = {
  card: {
    shadowColor: "#0767de",
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  } satisfies ViewStyle,
  btn: {
    shadowColor: "#0767de",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  } satisfies ViewStyle,
  modal: {
    shadowColor: "#042358",
    shadowOpacity: 0.18,
    shadowRadius: 60,
    shadowOffset: { width: 0, height: 20 },
    elevation: 12,
  } satisfies ViewStyle,
} as const;
