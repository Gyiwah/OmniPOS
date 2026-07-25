export function formatDate(value: string | number | Date) {
  return new Date(value).toLocaleDateString();
}

export function formatRelativeSyncTime(value: string | null | undefined): string {
  if (!value) return "Not synced yet";

  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "Not synced yet";

  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
