import type { ExpoConfig } from "expo/config";

/**
 * Dynamic so that plain HTTP can be allowed in a development build and refused
 * in a production one.
 *
 * This exists because of a failure that costs a day of hardware testing. Android
 * 9 and later block cleartext HTTP by default, and iOS blocks it through App
 * Transport Security. A Laravel dev server on a LAN address is plain HTTP, so on
 * a real phone every request is refused by the platform before it leaves the
 * app — and the client turns that into ApiError(0), which `isUnreachable`
 * reports as "offline".
 *
 * The till therefore looks like it is working perfectly, offline, for ever.
 * Nothing is broken on screen and nothing in the logs says why.
 *
 * Allowing cleartext everywhere would fix the test and leave a production build
 * willing to talk to any http:// host, so it is scoped:
 *
 *   Android — usesCleartextTraffic only when this is not a production build.
 *   iOS     — NSAllowsLocalNetworking, which permits HTTP to LAN addresses
 *             without disabling ATS for the internet at large.
 *
 * A production build should be pointed at an https:// API, and then neither of
 * these applies.
 */

// EAS sets this on a build server. Locally it is undefined, which is a
// development build by definition — you are running `expo run` on your own
// machine against your own server.
const profile = process.env.EAS_BUILD_PROFILE;
const isProduction = profile === "production";

const config: ExpoConfig = {
  name: "OmniPOS",
  slug: "OmniPOS",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "omnipos",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  /*
   * Off, because the local database does not work with it on.
   *
   * WatermelonDB 0.28 ships a legacy bridge module. The New Architecture runs
   * bridgeless, where legacy ReactPackage modules are not exposed to JS at all
   * unless interop is explicitly enabled — so WMDatabaseBridge was compiled,
   * linked and registered in PackageList, and still invisible at runtime.
   * Probed on a device: absent from both NativeModules and TurboModuleRegistry,
   * at module load and three seconds later.
   *
   * The app degraded rather than failed, which is why it went unnoticed. It
   * fell back to the in-memory Loki adapter, so a till rebuilt its schema and
   * re-pulled the whole catalogue on every launch — slow — and, far worse, kept
   * every offline sale somewhere that does not survive a restart. In a
   * production build the same fallback throws instead, so it would not have
   * shipped silently, but it would have refused to start.
   *
   * Turn this back on only once WatermelonDB is bridgeless-compatible, and
   * prove it by checking the database adapter on a device rather than by the
   * app merely opening.
   */
  newArchEnabled: false,

  plugins: [
    "expo-router",
    "expo-sqlite",
    ["@morrowdigital/watermelondb-expo-plugin", { disableJsi: true }],
    "expo-secure-store",
    [
      "expo-build-properties",
      {
        android: {
          // False in production: a shipped till must not be willing to talk
          // plain HTTP to anything.
          usesCleartextTraffic: !isProduction,
        },
      },
    ],
  ],

  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#fafbfb",
  },

  ios: {
    supportsTablet: true,
    infoPlist: {
      NSBluetoothAlwaysUsageDescription: "OmniPOS uses Bluetooth to connect to receipt printers.",
      NSBluetoothPeripheralUsageDescription: "OmniPOS uses Bluetooth to discover and connect to receipt printers.",
      /*
       * iOS 14 and later prompt before an app may reach anything on the local
       * network. Without this string the prompt cannot be shown, so the request
       * simply fails — again presenting as "offline".
       */
      NSLocalNetworkUsageDescription:
        "OmniPOS connects to the shop's server on this network to sync sales and stock.",
      NSAppTransportSecurity: {
        // Narrow on purpose. This permits HTTP to LAN addresses and leaves ATS
        // enforced for everything else, unlike NSAllowsArbitraryLoads.
        NSAllowsLocalNetworking: !isProduction,
      },
    },
  },

  android: {
    package: "com.gyiwah.omnipos",
    permissions: [
      "android.permission.BLUETOOTH",
      "android.permission.BLUETOOTH_ADMIN",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.BLUETOOTH_SCAN",
      "android.permission.ACCESS_FINE_LOCATION",
    ],
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#fafbfb",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
  },

  web: { favicon: "./assets/favicon.png" },

  extra: {
    router: {},
    eas: { projectId: "fa2f252b-ac2d-4f7e-87e2-0d7b4a57de4e" },
  },
};

export default config;
