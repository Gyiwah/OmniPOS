import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * That this installation has one identity, and the server is told about it.
 *
 * Two faults, both silent, and neither visible without a second till:
 *
 *   1. registerDevice() was written and never called, so no device had ever
 *      registered. The pull sends device_id so the server can withhold a
 *      till's own writes from its own changefeed; an unknown device defeats
 *      that, and the till pulls back everything it just pushed.
 *
 *   2. The access token is named after the device, and auth read the storage
 *      key directly rather than through getDeviceId, which mints it. On a
 *      fresh install the key does not exist yet — sign-in precedes the first
 *      sync — so the name fell back to "mobile:unregistered". The server
 *      revokes an existing token of the same name when it issues one, so two
 *      fresh tills shared a name and the second sign-in signed the first out.
 *
 * Read from source: exercising either needs the native database and a server.
 */
describe("device identity", () => {
  const sync = readFileSync(join(process.cwd(), "src/sync/laravelSync.ts"), "utf8");
  const auth = readFileSync(join(process.cwd(), "src/features/auth/laravelAuth.ts"), "utf8");
  const shared = readFileSync(join(process.cwd(), "src/sync/deviceId.ts"), "utf8");

  it("is minted in exactly one place", () => {
    expect(shared).toMatch(/export async function getDeviceId/);

    // The storage key must not be read anywhere else, or a caller can observe
    // its absence instead of minting it — which is the bug.
    expect(sync).not.toContain('"omnipos_laravel_device_id"');
    expect(auth).not.toContain('"omnipos_laravel_device_id"');
  });

  it("names the token after a device id that is guaranteed to exist", () => {
    expect(auth).toMatch(/`mobile:\$\{await getDeviceId\(\)\}`/);

    // The fallback is what produced a shared name; the word may still appear in
    // the comment explaining why, so match the expression rather than the prose.
    expect(auth).not.toMatch(/\?\?\s*"unregistered"/);
  });

  it("registers the device with the server during a sync", () => {
    expect(sync).toMatch(/await ensureDeviceRegistered\(\)/);
  });

  /** Before the push, so operations are attributed to a device the server knows. */
  it("registers before pushing, not after", () => {
    const register = sync.indexOf("await ensureDeviceRegistered()");
    const push = sync.indexOf("await pushQueue(storeId)");

    expect(register).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(-1);
    expect(register).toBeLessThan(push);
  });

  /**
   * A till whose registration fails must still be able to send its takings.
   * Registration is a convenience for the server, not a precondition for money.
   */
  it("never lets a failed registration stop a sync", () => {
    expect(sync).toMatch(/registerDevice\(\)\.catch\(/);
  });

  /** Once per process, not once per sync. */
  it("does not re-register on every sync", () => {
    expect(sync).toMatch(/registration \?\?=/);
  });
});
