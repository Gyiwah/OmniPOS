export function isRequired(value: string) {
  return value.trim().length > 0;
}

export function isNonNegativeNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0;
}

export function isPositiveNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 1;
}
