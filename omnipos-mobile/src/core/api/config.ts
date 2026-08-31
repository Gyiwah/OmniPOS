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

export type Backend = "supabase" | "laravel";

/**
 * Defaults to Supabase so an existing build is unaffected by this code landing.
 * Set EXPO_PUBLIC_BACKEND=laravel to point a development build at the new API.
 */
export const BACKEND: Backend =
  process.env.EXPO_PUBLIC_BACKEND === "laravel" ? "laravel" : "supabase";

export const usingLaravel = BACKEND === "laravel";

/**
 * Absolute, because a native app has no origin to be relative to.
 *
 * On a device, `localhost` is the phone itself — a LAN address or tunnel is
 * required to reach a development machine. Getting this wrong presents as
 * "network request failed" with nothing else to go on, so it is validated at
 * startup rather than at the first request.
 */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

export function assertApiConfigured(): void {
  if (!usingLaravel) return;

  if (!API_BASE_URL) {
    throw new Error(
      "EXPO_PUBLIC_API_URL is not set. Point it at the Laravel API, e.g. http://192.168.1.10:8000 — " +
        "a device cannot reach your machine on localhost.",
    );
  }

  if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(API_BASE_URL) && process.env.EXPO_PUBLIC_ALLOW_LOCALHOST !== "1") {
    // Works in a simulator, silently fails on hardware. Loud is better here.
    console.warn(
      `[OmniPOS] EXPO_PUBLIC_API_URL is ${API_BASE_URL}. On a physical device this points at the device ` +
        "itself, not your computer. Use the machine's LAN address.",
    );
  }
}
