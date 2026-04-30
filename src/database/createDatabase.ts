import { Database } from "@nozbe/watermelondb";
import LokiJSAdapter from "@nozbe/watermelondb/adapters/lokijs";
import SQLiteAdapter from "@nozbe/watermelondb/adapters/sqlite";
import { NativeModules, Platform } from "react-native";

import { Product, SyncQueueItem } from "./models";
import wmSchema from "./wmSchema";
let warnedMissingBridge = false;

function hasWatermelonNativeBridge(): boolean {
  return Boolean(
    (NativeModules as { WMDatabaseBridge?: object }).WMDatabaseBridge,
  );
}

/**
 * SQLite needs a native rebuild (`npx expo run:android` / `run:ios`) after adding
 * `@morrowdigital/watermelondb-expo-plugin`. Expo Go and older dev clients omit `WMDatabaseBridge`.
 */
function createAdapter() {
  if (Platform.OS === "web") {
    return new LokiJSAdapter({
      schema: wmSchema,
      dbName: "omnipos",
      useWebWorker: false,
      useIncrementalIndexedDB: true,
    });
  }

  if (hasWatermelonNativeBridge()) {
    return new SQLiteAdapter({
      schema: wmSchema,
      dbName: "omnipos",
      jsi: false,
    });
  }

  if (__DEV__) {
    if (!warnedMissingBridge) {
      warnedMissingBridge = true;
      // eslint-disable-next-line no-console -- intentional operator-facing warning
      console.warn(
        "[OmniPOS] WMDatabaseBridge missing — using in-memory Loki (data resets on reload). Rebuild native: `npx expo run:android` or `npm run dev:android`.",
      );
    }
    return new LokiJSAdapter({
      schema: wmSchema,
      dbName: "omnipos",
      useWebWorker: false,
      // `false` is deprecated in WatermelonDB; RN has no IndexedDB, so Loki still uses memory.
      useIncrementalIndexedDB: true,
    });
  }

  throw new Error(
    "WatermelonDB native module is missing. Create a dev/production build with `npx expo run:android` (or EAS Build), not Expo Go.",
  );
}

export function createWatermelonDb() {
  return new Database({
    adapter: createAdapter(),
    modelClasses: [Product, SyncQueueItem],
  });
}
