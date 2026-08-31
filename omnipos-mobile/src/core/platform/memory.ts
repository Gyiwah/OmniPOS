import type { NetworkState, PlatformAdapter } from "./types";

/**
 * Dependency-free fallback adapter. Used by unit tests and by any code path that
 * runs before the host app registers a real adapter. Storage is process-local and
 * non-persistent; network always reports online.
 */
export function createMemoryAdapter(): PlatformAdapter {
  const store = new Map<string, string>();
  const listeners = new Set<(state: NetworkState) => void>();
  const online: NetworkState = { isConnected: true, isInternetReachable: true };

  return {
    name: "memory",
    capabilities: { sqlite: false, persistentDatabase: false },
    storage: {
      async getItem(key) {
        return store.has(key) ? (store.get(key) as string) : null;
      },
      async setItem(key, value) {
        store.set(key, value);
      },
      async removeItem(key) {
        store.delete(key);
      },
    },
    network: {
      async getState() {
        return online;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    secureStorage: null,
    createDeepLink: (path) => `omnipos://${path.replace(/^\//, "")}`,
    crypto: {
      getRandomValues(bytes) {
        const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
        if (!webCrypto?.getRandomValues) {
          // Deliberately fatal: silently degrading to Math.random would weaken
          // both ID uniqueness and the offline encryption key material.
          throw new Error(
            "[OmniPOS] No secure random source. Register a platform adapter via setPlatform() before generating IDs or keys.",
          );
        }
        return webCrypto.getRandomValues(bytes);
      },
    },
  };
}
