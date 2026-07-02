import { requireNativeModule } from "expo-modules-core";

/**
 * Expo dev mode enables keep-awake via withDevTools. On Expo Go / some Android hosts
 * activation rejects with "Unable to activate keep awake" as an uncaught promise.
 */
if (__DEV__) {
  try {
    const ExpoKeepAwake = requireNativeModule<{ activate?: (tag: string) => Promise<void> }>("ExpoKeepAwake");
    if (typeof ExpoKeepAwake.activate === "function") {
      const originalActivate = ExpoKeepAwake.activate.bind(ExpoKeepAwake);
      ExpoKeepAwake.activate = (tag: string) =>
        originalActivate(tag).catch(() => {
          // Keep-awake is optional in development.
        });
    }
  } catch {
    // Native module unavailable in this runtime.
  }
}
