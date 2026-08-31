/**
 * Platform seam for the shared OmniPOS core.
 *
 * Everything under `src/core`, `src/database`, `src/sync` and the non-hardware
 * `src/features` services must reach the host platform through these interfaces
 * rather than importing `react-native` / `expo-*` directly. That is what lets the
 * same database, sync engine and business services run under React Native (SQLite)
 * and in the browser (IndexedDB) without a second implementation.
 */

/** Async key/value storage. Backed by AsyncStorage on native, localStorage on web. */
export type PlatformStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type NetworkState = {
  /** Device believes it has a network interface up. */
  isConnected: boolean;
  /**
   * Device believes the wider internet is reachable. Null when the platform
   * cannot determine reachability (browsers cannot), which callers must treat
   * as "assume reachable" rather than "offline".
   */
  isInternetReachable: boolean | null;
};

export type PlatformNetwork = {
  getState(): Promise<NetworkState>;
  /** Subscribe to connectivity changes. Returns an unsubscribe function. */
  subscribe(listener: (state: NetworkState) => void): () => void;
};

/**
 * Hardware-backed / OS-managed secret storage (Keychain, Keystore). Null on hosts
 * that have no equivalent — browsers do not, and pretending otherwise would give
 * a false sense of protection for key material.
 */
export type PlatformSecureStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type PlatformCrypto = {
  /** Cryptographically secure random bytes, filled in place. */
  getRandomValues(bytes: Uint8Array): Uint8Array;
};

/**
 * Host capabilities the shared core must branch on. Kept here rather than probed
 * inline so that no shared module needs to import `react-native` to find out.
 */
export type PlatformCapabilities = {
  /**
   * A native WatermelonDB SQLite bridge is linked and usable. False in browsers,
   * and false in Expo Go / dev clients built before the WatermelonDB plugin was
   * added, where the core falls back to LokiJS.
   */
  sqlite: boolean;
  /** Persistent local database available (IndexedDB in browsers, SQLite on device). */
  persistentDatabase: boolean;
};

export type PlatformAdapter = {
  name: "native" | "web" | "memory";
  capabilities: PlatformCapabilities;
  storage: PlatformStorage;
  network: PlatformNetwork;
  crypto: PlatformCrypto;
  secureStorage: PlatformSecureStorage | null;
  /** Absolute URL that reopens this app at `path` (deep link on device, origin URL on web). */
  createDeepLink(path: string): string;
};
