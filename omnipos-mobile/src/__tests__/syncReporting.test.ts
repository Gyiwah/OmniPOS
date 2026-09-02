import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * That a failing sync is visible to the person using the till.
 *
 * Two faults made a Laravel build fail silently on hardware, and neither shows
 * up anywhere a normal test would look:
 *
 *   1. Only the Supabase engine ever wrote to the sync store, so on a Laravel
 *      build syncStatus stayed "idle" for ever and the home screen's error line
 *      — conditional on it — never rendered. A till whose sync had been failing
 *      all day looked exactly like one with nothing to send.
 *
 *   2. A request that failed while the device HAD a network was reported as
 *      "offline". That covers a platform blocking cleartext HTTP, a firewall, a
 *      server bound to 127.0.0.1 and a wrong address — every one of them showing
 *      an Offline badge on a phone with four bars.
 *
 * Read from source because both are structural: the wiring existing at all is
 * the property, and a runtime test would need the native modules this code
 * imports.
 */
describe("a failing sync is visible", () => {
  const entry = readFileSync(join(process.cwd(), "src/sync/index.ts"), "utf8");
  const laravel = readFileSync(join(process.cwd(), "src/sync/laravelSync.ts"), "utf8");

  it("reports the outcome from the entry point both transports pass through", () => {
    expect(entry).toContain("useSyncStore");
    expect(entry).toContain("setSyncStatus");
    expect(entry).toContain("setLastError");
  });

  it("routes the Laravel result through the same reporting as the other transport", () => {
    // Not just imported — actually applied to what runLaravelSync returned.
    expect(entry).toMatch(/return report\(\{[\s\S]*?runLaravelSync|const result = await runLaravelSync[\s\S]*?return report\(/);
  });

  /**
   * A till is expected to work offline. Colouring that red would train people to
   * ignore the colour, and then the real failure goes unnoticed too.
   */
  it("does not raise an error for genuinely having no network", () => {
    expect(entry).toContain('summary.reason === "offline"');
    expect(entry).toMatch(/merelyOffline \? "idle" : "error"/);
  });

  it("does not call an unreachable server 'offline' when the device has a network", () => {
    // The one remaining "offline" is the branch that checked connectivity first.
    const offlineReturns = laravel.match(/reason: "offline"/g) ?? [];

    expect(offlineReturns).toHaveLength(1);
    expect(laravel).toContain("Cannot reach the server:");
  });

  it("carries the underlying message rather than a single word", () => {
    expect(laravel).toMatch(/Cannot reach the server: \$\{error\.message\}/);
  });
});
