export function formatDate(value: string | number | Date) {
  return new Date(value).toLocaleDateString();
}
