import { TextStyle } from "react-native";

/** Type scale + weights — Inter when loaded; System default otherwise */
export const Typography = {
  display: { fontSize: 32, fontWeight: "800" as TextStyle["fontWeight"] },
  headline: { fontSize: 24, fontWeight: "700" as TextStyle["fontWeight"] },
  title: { fontSize: 18, fontWeight: "600" as TextStyle["fontWeight"] },
  body: { fontSize: 15, fontWeight: "400" as TextStyle["fontWeight"] },
  caption: { fontSize: 12, fontWeight: "400" as TextStyle["fontWeight"] },
  overline: {
    fontSize: 10,
    fontWeight: "600" as TextStyle["fontWeight"],
    letterSpacing: 0.8,
    textTransform: "uppercase" as const,
  },
} as const;
