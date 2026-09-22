/** OmniPOS Blue & Orange — SaaS retail POS palette + backward-compatible shortcuts */
export const Colors = {
  primaryBlue: "#0767de",
  primaryBlueLight: "#4d93ea",
  primaryBluePale: "#dcecff",

  navy: "#042358",
  navyLight: "#1f417a",
  navyDark: "#021634",

  background: "#fafbfb",
  surface: "#ffffff",

  accentOrange: "#fe7403",
  accentOrangeLight: "#ff9b4a",
  accentOrangePale: "#fff1e6",

  success: "#16a34a",
  danger: "#dc2626",
  warning: "#f59e0b",

  border: "#d8e2f0",
  divider: "#edf2f7",

  textPrimary: "#042358",
  textSecondary: "#4b5563",
  textMuted: "#94a3b8",
  textWhite: "#ffffff",

  /* Shortcuts used across existing screens — map to semantic tokens above */
  primary: "#0767de",
  secondary: "#042358",
  accent: "#fe7403",
  white: "#ffffff",
  black: "#000000",
  surfaceSecondary: "#f1f5f9",
  text: "#042358",
  mutedText: "#94a3b8",
} as const;

export type ColorToken = keyof typeof Colors;
