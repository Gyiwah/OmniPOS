import type { NetworkState, PlatformAdapter } from "./types";

/**
 * Browser adapter for the forthcoming OmniPOS web/PWA client.
 *
 * `localStorage` is synchronous; the async signatures are preserved so the shared
 * core sees one interface across platforms. Browsers cannot probe true internet
 * reachability, so `isInternetReachable` is reported as null ("unknown") and the
 * sync engine treats that as reachable rather than offline.
 */
export function createWebAdapter(): PlatformAdapter {
  const read = (key: string): string | null => {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      // Private-mode / disabled storage: behave as empty rather than throwing.
      return null;
    }
  };

  const toState = (): NetworkState => ({
    isConnected: globalThis.navigator?.onLine !== false,
    isInternetReachable: null,
  });

  return {
    name: "web",
    capabilities: {
      sqlite: false,
      persistentDatabase: typeof globalThis.indexedDB !== "undefined",
    },
    storage: {
      async getItem(key) {
        return read(key);
      },
      async setItem(key, value) {
        try {
          globalThis.localStorage?.setItem(key, value);
        } catch {
          // Quota or disabled storage — non-fatal for cache-style writes.
        }
      },
      async removeItem(key) {
        try {
          globalThis.localStorage?.removeItem(key);
        } catch {
          // ignore
        }
      },
    },
    network: {
      async getState() {
        return toState();
      },
      subscribe(listener) {
        const handler = () => listener(toState());
        globalThis.addEventListener?.("online", handler);
        globalThis.addEventListener?.("offline", handler);
        return () => {
          globalThis.removeEventListener?.("online", handler);
          globalThis.removeEventListener?.("offline", handler);
        };
      },
    },
    // Browsers have no keychain equivalent; the core must degrade rather than
    // store key material somewhere a page script could read it.
    secureStorage: null,
    createDeepLink: (path) => new URL(path, globalThis.location?.origin ?? "http://localhost").toString(),
    packagerHostUri: () => null,
    crypto: {
      getRandomValues(bytes) {
        const webCrypto = globalThis.crypto;
        if (!webCrypto?.getRandomValues) {
          throw new Error("[OmniPOS] Secure random unavailable; a secure context (HTTPS) is required.");
        }
        return webCrypto.getRandomValues(bytes);
      },
    },
  };
}
