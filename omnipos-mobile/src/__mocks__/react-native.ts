/**
 * Minimal react-native stand-in for Jest.
 *
 * The real package ships untranspiled Flow/ESM that ts-jest's node environment
 * cannot parse. Only the surface the shared core touches at import time is needed:
 * `createDatabase` reads Platform.OS and probes NativeModules to choose an adapter,
 * and with no WMDatabaseBridge present it falls back to in-memory LokiJS — which is
 * exactly what unit tests want.
 */
export const Platform = { OS: "ios", select: (spec: Record<string, unknown>) => spec.ios ?? spec.default };
export const NativeModules: Record<string, unknown> = {};
export const PermissionsAndroid = {
  PERMISSIONS: {},
  RESULTS: {},
  request: async () => "granted",
  requestMultiple: async () => ({}),
};
export const Alert = { alert: () => undefined };
export const AppState = { addEventListener: () => ({ remove: () => undefined }), currentState: "active" };
