import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The app shell must be complete in the service worker's precache.
 *
 * A till that opens with no connection loads entirely from that cache. If one
 * asset index.html references is missing from it — a stylesheet, the JS bundle,
 * a font added later — the shell fails to load and the shop cannot sell,
 * offline, with no obvious cause. It would also pass every other test here,
 * because everything works while the network is up.
 *
 * Checked against the real build output rather than the config, so a change to
 * globPatterns that quietly stops matching something is caught.
 */

const DIST = resolve(__dirname, "../../dist");

function readDist(file: string): string | null {
  const path = resolve(DIST, file);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function precachedUrls(sw: string): string[] {
  // The manifest is inlined as precacheAndRoute([{url:"…",revision:"…"},…]).
  const urls = [...sw.matchAll(/\{url:"([^"]+)"/g)].map((m) => m[1]);
  return urls;
}

function shellAssets(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)]
    .map((m) => m[1].replace(/^\//, ""))
    // The manifest is fetched by the browser, not needed to render the shell.
    .filter((u) => u !== "manifest.webmanifest");
}

const sw = readDist("sw.js");
const html = readDist("index.html");
const built = sw !== null && html !== null;

describe.skipIf(!built)("service worker precache", () => {
  it("covers every asset the shell needs to render", () => {
    const cached = new Set(precachedUrls(sw!));
    const missing = shellAssets(html!).filter((asset) => !cached.has(asset));

    expect(missing).toEqual([]);
  });

  it("includes index.html so a navigation can be served offline", () => {
    // The SPA navigation fallback is bound to this file; without it in the
    // cache, opening the app offline gets nothing at all.
    expect(precachedUrls(sw!)).toContain("index.html");
  });

  it("registers a navigation route bound to the shell", () => {
    expect(sw).toMatch(/NavigationRoute/);
    expect(sw).toMatch(/createHandlerBoundToURL\("index\.html"\)/);
  });

  /**
   * Offline reads come from IndexedDB, which the sync engine maintains and
   * reconciles. An HTTP cache of API responses would be a second, stale copy of
   * the same data that nothing reconciles — it would disagree with the database
   * and there would be no way to tell which was right.
   */
  it("does not precache any API response", () => {
    const apiEntries = precachedUrls(sw!).filter((u) => u.startsWith("api/") || u.includes("/api/"));
    expect(apiEntries).toEqual([]);
  });

  it("excludes API paths from the navigation fallback", () => {
    expect(sw).toMatch(/denylist/i);
  });

  it("precaches the icons, so an installed till shows its own branding offline", () => {
    const cached = precachedUrls(sw!);
    for (const icon of ["favicon.ico", "android-chrome-192x192.png", "android-chrome-512x512.png"]) {
      expect(cached).toContain(icon);
    }
  });
});
