/**
 * Metro LAN host parsing. Kept free of Expo so the shared core can rewrite
 * loopback API URLs without importing a platform package.
 */
export function packagerLanHost(hostUri?: string | null): string | null {
  const match = String(hostUri ?? "").match(/(\d{1,3}(?:\.\d{1,3}){3})/);
  const host = match?.[1] ?? null;
  if (!host || host === "127.0.0.1" || host === "10.0.2.2") return null;
  return host;
}
