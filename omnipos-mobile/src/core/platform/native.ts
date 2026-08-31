import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { NativeModules } from "react-native";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";

import type { NetworkState, PlatformAdapter } from "./types";

/**
 * React Native / Expo adapter. This module is the ONLY place in the shared core
 * allowed to import AsyncStorage, NetInfo or expo-crypto.
 */
/**
 * SQLite needs a native rebuild (`npx expo run:android` / `run:ios`) after adding
 * `@morrowdigital/watermelondb-expo-plugin`. Expo Go and older dev clients omit
 * `WMDatabaseBridge`.
 */
function hasWatermelonNativeBridge(): boolean {
  return Boolean((NativeModules as { WMDatabaseBridge?: object }).WMDatabaseBridge);
}

export function createNativeAdapter(): PlatformAdapter {
  const sqlite = hasWatermelonNativeBridge();
  return {
    name: "native",
    capabilities: { sqlite, persistentDatabase: sqlite },
    storage: {
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
      removeItem: (key) => AsyncStorage.removeItem(key),
    },
    network: {
      async getState(): Promise<NetworkState> {
        const state = await NetInfo.fetch();
        return {
          isConnected: state.isConnected !== false,
          isInternetReachable: state.isInternetReachable ?? null,
        };
      },
      subscribe(listener) {
        return NetInfo.addEventListener((state) => {
          listener({
            isConnected: state.isConnected !== false,
            isInternetReachable: state.isInternetReachable ?? null,
          });
        });
      },
    },
    crypto: {
      getRandomValues: (bytes) => Crypto.getRandomValues(bytes),
    },
    secureStorage: {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) =>
        SecureStore.setItemAsync(key, value, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED,
        }),
    },
    createDeepLink: (path) => Linking.createURL(path),
  };
}
