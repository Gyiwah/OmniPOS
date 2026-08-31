import { Database } from "@nozbe/watermelondb";
import LokiJSAdapter from "@nozbe/watermelondb/adapters/lokijs";

import { getPlatform } from "@/src/core/platform";
import {
  Product,
  Order,
  OrderItem,
  Customer,
  SyncQueueItem,
  ProductBatch,
  StockMovement,
  PriceHistory,
  RegisterShift,
} from "./models";
import migrations from "./migrations";
import wmSchema from "./wmSchema";

let warnedMissingBridge = false;

/**
 * Adapter selection is driven by the registered platform adapter rather than by a
 * direct `react-native` import, so this module is safe to load in a browser build
 * of the shared core.
 *
 *   native + SQLite bridge -> SQLiteAdapter   (device, persistent)
 *   web                    -> LokiJS/IndexedDB (browser, persistent)
 *   anything else          -> LokiJS in-memory (Expo Go, tests; resets on reload)
 */
function createAdapter() {
  const platform = getPlatform();

  if (platform.capabilities.sqlite) {
    const SQLiteAdapter = require("@nozbe/watermelondb/adapters/sqlite").default;
    return new SQLiteAdapter({
      schema: wmSchema,
      migrations,
      dbName: "omnipos",
      jsi: false,
    });
  }

  if (platform.name === "web") {
    return new LokiJSAdapter({
      schema: wmSchema,
      migrations,
      dbName: "omnipos",
      useWebWorker: false,
      useIncrementalIndexedDB: true,
    });
  }

  const isDevOrTest =
    typeof __DEV__ === "undefined" || __DEV__ || process.env.NODE_ENV === "test";

  if (platform.name === "native" && isDevOrTest) {
    if (!warnedMissingBridge && process.env.NODE_ENV !== "test") {
      warnedMissingBridge = true;
      // eslint-disable-next-line no-console -- intentional operator-facing warning
      console.warn(
        "[OmniPOS] WMDatabaseBridge missing — using in-memory Loki (data resets on reload). Rebuild native: `npx expo run:android` or `npm run dev:android`.",
      );
    }
  } else if (platform.name === "native") {
    throw new Error(
      "WatermelonDB native module is missing. Create a dev/production build with `npx expo run:android` (or EAS Build), not Expo Go.",
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
      RegisterShift,
    ],
  });
}
