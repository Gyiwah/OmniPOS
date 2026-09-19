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

import { getPlatform } from "@/src/core/platform";
import { packagerLanHost } from "./packagerHost";

export { packagerLanHost };

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

function configuredApiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? "";
}

function packagerHostForRewrite(): string | null {
  return process.env.EXPO_PUBLIC_ALLOW_LOCALHOST === "1" ? null : getPlatform().packagerHostUri();
}

/**
 * Absolute, because a native app has no origin to be relative to.
 *
 * Bound again after `setPlatform()` so a physical device can rewrite loopback
 * URLs onto Metro's LAN host. A deployed https URL is left as-is.
 */
export let API_BASE_URL = resolveApiBaseUrl(configuredApiUrl(), packagerHostForRewrite());

export function bindApiBaseUrl(): void {
  const configured = configuredApiUrl();
  API_BASE_URL = resolveApiBaseUrl(configured, packagerHostForRewrite());
  if (usingLaravel && configured.replace(/\/+$/, "") !== API_BASE_URL) {
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
