/**
 * Which backend this build talks to.
 *
 * The migration is staged deliberately: Supabase stays live and authoritative
 * until a Laravel build has been proven against real tills. Both transports
 * therefore have to coexist for a while, selected at build time rather than
 * scattered through the code as conditionals.
 *
 * This is a switch over the TRANSPORT, not two copies of the sync logic. The
 * Laravel path has one implementation, and it is the same protocol the web till
 * already uses.
 */

import Constants from "expo-constants";

export type Backend = "supabase" | "laravel";

/**
 * Defaults to Supabase so an existing build is unaffected by this code landing.
 * Set EXPO_PUBLIC_BACKEND=laravel to point a development build at the new API.
 */
export const BACKEND: Backend =
  process.env.EXPO_PUBLIC_BACKEND === "laravel" ? "laravel" : "supabase";

export const usingLaravel = BACKEND === "laravel";

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|\[::1\])(?::(\d+))?/i;

/**
 * The IPv4 Metro is serving from, if the bundler advertised one.
 *
 * That is the machine the phone already reached to download the JS bundle, so
 * it is also the machine a development Laravel API almost always lives on.
 */
export function packagerLanHost(hostUri?: string | null): string | null {
  const match = String(hostUri ?? "").match(/(\d{1,3}(?:\.\d{1,3}){3})/);
  const host = match?.[1] ?? null;
  if (!host || host === "127.0.0.1" || host === "10.0.2.2") return null;
  return host;
}

/**
 * A URL a physical phone can actually call.
 *
 * `localhost` is the phone. `10.0.2.2` is only the Android emulator's alias
 * for the host — on hardware it is a black hole and the fetch presents as
 * "Network request failed". When the configured URL is one of those, rewrite
 * it onto the Metro LAN host and keep the same port.
 */
export function resolveApiBaseUrl(configured: string, packagerHost: string | null): string {
  const stripped = configured.replace(/\/+$/, "");
  const loopback = stripped.match(LOOPBACK);

  if (loopback && packagerHost) {
    return `http://${packagerHost}:${loopback[2] ?? "8000"}`;
  }

  if (!stripped && packagerHost) {
    return `http://${packagerHost}:8000`;
  }

  return stripped;
}

function currentPackagerHost(): string | null {
  try {
    return packagerLanHost(Constants.expoConfig?.hostUri ?? Constants.linkingUri);
  } catch {
    return null;
  }
}

/**
 * Absolute, because a native app has no origin to be relative to.
 *
 * On a device, `localhost` is the phone itself — a LAN address or tunnel is
 * required to reach a development machine. Getting this wrong presents as
 * "network request failed" with nothing else to go on, so it is validated at
 * startup rather than at the first request.
 */
export const API_BASE_URL = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_URL ?? "",
  process.env.EXPO_PUBLIC_ALLOW_LOCALHOST === "1" ? null : currentPackagerHost(),
);

if (usingLaravel) {
  const configured = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
  if (configured !== API_BASE_URL) {
    console.log(`[OmniPOS] API ${configured || "(unset)"} → ${API_BASE_URL}`);
  }
}

export function assertApiConfigured(): void {
  if (!usingLaravel) return;

  if (!API_BASE_URL) {
    throw new Error(
      "EXPO_PUBLIC_API_URL is not set. Point it at the Laravel API, e.g. http://192.168.1.10:8000 — " +
        "a device cannot reach your machine on localhost.",
    );
  }

  if (
    LOOPBACK.test(API_BASE_URL) &&
    process.env.EXPO_PUBLIC_ALLOW_LOCALHOST !== "1"
  ) {
    // Works in a simulator, silently fails on hardware. Loud is better here.
    console.warn(
      `[OmniPOS] EXPO_PUBLIC_API_URL is ${API_BASE_URL}. On a physical device this points at the device ` +
        "itself, not your computer. Use the machine's LAN address.",
    );
  }
}
