export function normalizeBarcode(value: string) {
  return value.replace(/\s+/g, "");
}
