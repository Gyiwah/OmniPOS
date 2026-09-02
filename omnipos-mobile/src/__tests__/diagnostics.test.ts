import { readFileSync } from "node:fs";
import { join } from "node:path";

import { asReport, summarise, type CheckResult } from "@/src/features/diagnostics/checks";

/**
 * The device check, and the build settings it exists to catch.
 *
 * The checks themselves need a device to run, so what is tested here is the two
 * things that can be: the reporting a tester will actually read, and the config
 * that decides whether any request leaves the app at all.
 */

function result(over: Partial<CheckResult> = {}): CheckResult {
  return { id: "x", title: "Something", status: "pass", detail: "fine", ...over };
}

describe("the report a tester sends back", () => {
  it("counts each outcome", () => {
    const summary = summarise([
      result({ status: "pass" }),
      result({ status: "pass" }),
      result({ status: "fail" }),
      result({ status: "warn" }),
      result({ status: "skip" }),
    ]);

    expect(summary).toBe("2 passed, 1 failed, 1 to check, 1 skipped");
  });

  /**
   * Shared as text on purpose. A tester on a shop floor sends this from a phone;
   * a screenshot of a scrolling list loses whichever half did not fit.
   */
  it("includes the remedy, not just the symptom", () => {
    const report = asReport([
      result({
        title: "Server reachable",
        status: "fail",
        detail: "Network request failed",
        remedy: "The platform blocked plain HTTP.",
      }),
    ]);

    expect(report).toContain("FAIL Server reachable: Network request failed");
    expect(report).toContain("→ The platform blocked plain HTTP.");
  });

  it("marks each line so the outcome survives being pasted into a message", () => {
    const report = asReport([
      result({ title: "A", status: "pass" }),
      result({ title: "B", status: "warn" }),
      result({ title: "C", status: "skip" }),
    ]);

    expect(report).toContain("OK   A:");
    expect(report).toContain("WARN B:");
    expect(report).toContain("SKIP C:");
  });

  it("reports timings where a check measured one", () => {
    expect(asReport([result({ ms: 143 })])).toContain("(143ms)");
  });
});

/**
 * The build settings, read from the config source.
 *
 * Android 9+ blocks cleartext HTTP and iOS blocks it through App Transport
 * Security, so without these a development build against a LAN address has every
 * request refused before it leaves the app — and the client reports that as
 * "offline". The till looks like it is working, offline, for ever.
 *
 * Asserted against the source rather than a resolved config because the values
 * are deliberately conditional on the build profile, and the condition is the
 * part worth protecting: allowing cleartext unconditionally would ship a till
 * willing to talk plain HTTP to anything.
 */
describe("network permissions in the app config", () => {
  const source = readFileSync(join(process.cwd(), "app.config.ts"), "utf8");

  it("allows cleartext HTTP on Android for non-production builds", () => {
    expect(source).toContain("usesCleartextTraffic: !isProduction");
  });

  it("allows local networking on iOS for non-production builds", () => {
    expect(source).toContain("NSAllowsLocalNetworking: !isProduction");
  });

  /**
   * iOS 14+ will not even show the local-network prompt without a purpose
   * string, so the request fails with no way to grant permission.
   */
  it("declares why it wants the local network", () => {
    expect(source).toContain("NSLocalNetworkUsageDescription");
  });

  /**
   * The blanket setting. Allowing it would defeat the point of the narrow one.
   *
   * Matched as an assignment rather than as a word: the config names it in a
   * comment explaining why it is not used, and a bare `toContain` failed on
   * that comment — a test that would have to be deleted to keep the
   * explanation, which is the wrong way round.
   */
  it("never disables App Transport Security wholesale", () => {
    expect(source).not.toMatch(/NSAllowsArbitraryLoads\s*:/);
  });

  it("decides from the build profile rather than a hardcoded flag", () => {
    expect(source).toContain('process.env.EAS_BUILD_PROFILE');
    expect(source).toContain('profile === "production"');
  });
});
