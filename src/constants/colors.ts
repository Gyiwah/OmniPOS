export const Colors = {
  background: "#fafbfb",
  primary: "#0767de",
  secondary: "#042358",
  accent: "#fe7403",
  text: "#0f172a",
  mutedText: "#64748b",
  border: "#e2e8f0",
  white: "#ffffff",
} as const;

export type ColorToken = keyof typeof Colors;
