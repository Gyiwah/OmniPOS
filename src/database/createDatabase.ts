import { Database } from "@nozbe/watermelondb";
import LokiJSAdapter from "@nozbe/watermelondb/adapters/lokijs";
import { NativeModules, Platform } from "react-native";

import {
  Product,
  Order,
  OrderItem,
  Customer,
  SyncQueueItem,
  ProductBatch,
  StockMovement,
  PriceHistory,
} from "./models";
import migrations from "./migrations";
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
      migrations,
      dbName: "omnipos",
      useWebWorker: false,
      useIncrementalIndexedDB: true,
    });
  }

  if (hasWatermelonNativeBridge()) {
    const SQLiteAdapter = require("@nozbe/watermelondb/adapters/sqlite").default;
    return new SQLiteAdapter({
      schema: wmSchema,
      migrations,
      dbName: "omnipos",
      jsi: false,
    });
  }

  const isDevOrTest = typeof __DEV__ === "undefined" || __DEV__ || process.env.NODE_ENV === "test";
  if (isDevOrTest) {
    if (!warnedMissingBridge && process.env.NODE_ENV !== "test") {
      warnedMissingBridge = true;
      // eslint-disable-next-line no-console -- intentional operator-facing warning
      console.warn(
        "[OmniPOS] WMDatabaseBridge missing — using in-memory Loki (data resets on reload). Rebuild native: `npx expo run:android` or `npm run dev:android`.",
      );
    }
    return new LokiJSAdapter({
      schema: wmSchema,
      migrations,
      dbName: "omnipos",
      useWebWorker: false,
      useIncrementalIndexedDB: false,
    });
  }

  throw new Error(
    "WatermelonDB native module is missing. Create a dev/production build with `npx expo run:android` (or EAS Build), not Expo Go.",
  );
}

export function createWatermelonDb() {
  return new Database({
    adapter: createAdapter(),
    modelClasses: [
      Product,
      Order,
      OrderItem,
      Customer,
      SyncQueueItem,
      ProductBatch,
      StockMovement,
      PriceHistory,
    ],
  });
}
