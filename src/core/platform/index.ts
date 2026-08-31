import { createMemoryAdapter } from "./memory";
import type { PlatformAdapter, PlatformCrypto, PlatformNetwork, PlatformStorage } from "./types";

export type {
  NetworkState,
  PlatformAdapter,
  PlatformCrypto,
  PlatformNetwork,
  PlatformSecureStorage,
  PlatformStorage,
} from "./types";
export { createMemoryAdapter } from "./memory";

let current: PlatformAdapter = createMemoryAdapter();
let registered = false;

/**
 * Install the host platform implementation. Call once, as early as possible —
 * `index.ts` for the mobile app, the entry module for the web app.
 */
export function setPlatform(adapter: PlatformAdapter): void {
  current = adapter;
  registered = true;
}

export function getPlatform(): PlatformAdapter {
  return current;
}

/** True once a real (non-fallback) adapter has been installed. */
export function isPlatformRegistered(): boolean {
  return registered;
}

/**
 * Accessors are getters rather than captured references so that modules importing
 * them at load time still resolve to whichever adapter is registered at call time.
 */
export const storage: PlatformStorage = {
  getItem: (key) => current.storage.getItem(key),
  setItem: (key, value) => current.storage.setItem(key, value),
  removeItem: (key) => current.storage.removeItem(key),
};

export const network: PlatformNetwork = {
  getState: () => current.network.getState(),
  subscribe: (listener) => current.network.subscribe(listener),
};

export const platformCrypto: PlatformCrypto = {
  getRandomValues: (bytes) => current.crypto.getRandomValues(bytes),
};

/** Null on hosts without OS-managed secret storage; callers must handle that. */
export function getSecureStorage() {
  return current.secureStorage;
}

export function createDeepLink(path: string): string {
  return current.createDeepLink(path);
}
