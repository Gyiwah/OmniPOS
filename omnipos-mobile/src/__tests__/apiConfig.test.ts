import { packagerLanHost, resolveApiBaseUrl } from "../core/api/config";

describe("API address on a device", () => {
  it("reads the Metro LAN host from the bundler URI", () => {
    expect(packagerLanHost("10.227.143.183:8081")).toBe("10.227.143.183");
    expect(packagerLanHost("exp://10.227.143.183:8081/--/")).toBe("10.227.143.183");
  });

  it("ignores loopback bundler hosts — those are not reachable as an API", () => {
    expect(packagerLanHost("127.0.0.1:8081")).toBeNull();
    expect(packagerLanHost("10.0.2.2:8081")).toBeNull();
    expect(packagerLanHost(null)).toBeNull();
  });

  /**
   * The Android emulator alias. On a physical phone it routes nowhere, which is
   * exactly the "Network request failed" a cashier sees at sign-in.
   */
  it("rewrites the emulator alias onto the machine Metro is already serving from", () => {
    expect(resolveApiBaseUrl("http://10.0.2.2:8000", "10.227.143.183")).toBe(
      "http://10.227.143.183:8000",
    );
  });

  it("rewrites localhost the same way, keeping the configured port", () => {
    expect(resolveApiBaseUrl("http://127.0.0.1:8000", "10.227.143.183")).toBe(
      "http://10.227.143.183:8000",
    );
    expect(resolveApiBaseUrl("http://localhost:9000", "10.227.143.183")).toBe(
      "http://10.227.143.183:9000",
    );
  });

  it("leaves an explicit LAN address alone", () => {
    expect(resolveApiBaseUrl("http://192.168.1.10:8000", "10.227.143.183")).toBe(
      "http://192.168.1.10:8000",
    );
  });

  it("fills in Metro's host when no URL was configured at all", () => {
    expect(resolveApiBaseUrl("", "10.227.143.183")).toBe("http://10.227.143.183:8000");
  });
});
