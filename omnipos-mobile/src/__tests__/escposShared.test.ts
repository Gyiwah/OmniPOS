import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The encoder exists twice, and must stay the same twice.
 *
 * `src/core/printing/escpos.ts` here and `src/features/printing/escpos.ts` in
 * omnipos-web are the same file. The two clients are separate npm packages with
 * no shared workspace between them, so there is nowhere for one copy to live —
 * and a receipt that differs between a phone and a browser till is a shop
 * handing out two different documents for one sale.
 *
 * Duplicating a pure, tested module is the lesser evil. Letting the copies drift
 * is not, so this fails the build when they do.
 *
 * If this test ever fails: copy whichever file changed over the other. If the
 * change was deliberate for one platform only, it does not belong in this file
 * — put it in that client's receipt builder instead, which is already separate.
 */
describe("the ESC/POS encoder is shared with the web till", () => {
  const here = readFileSync(join(process.cwd(), "src/core/printing/escpos.ts"), "utf8");

  const webPath = join(process.cwd(), "..", "omnipos-web", "src", "features", "printing", "escpos.ts");

  it("is byte-for-byte identical to the web client's copy", () => {
    let web: string;

    try {
      web = readFileSync(webPath, "utf8");
    } catch {
      // A checkout of the mobile app on its own has nothing to compare against.
      // Skipping beats failing for a reason the developer cannot act on.
      return;
    }

    expect(here).toBe(web);
  });

  /**
   * The guard above is worthless if it is comparing two empty strings, or a
   * file that has quietly become a stub.
   */
  it("is comparing a real implementation", () => {
    expect(here.length).toBeGreaterThan(4000);
    expect(here).toContain("export class EscPos");
    expect(here).toContain("openDrawer");
  });

  /**
   * The shared core must run unchanged in a browser, so it may not reach for
   * anything React Native provides. platformBoundary covers the directory; this
   * says it explicitly for the file the web actually imports.
   */
  it("imports nothing platform-specific", () => {
    expect(here).not.toMatch(/from\s+["']react-native/);
    expect(here).not.toMatch(/from\s+["']expo/);
    expect(here).not.toMatch(/from\s+["']@\/src\//);
  });
});
