import type { PrinterDevice } from "@/src/features/printer/types";
import { printerFeatureService } from "@/src/features/printer/service";

export type { PrinterDevice };

export const printerService = {
  isNativeAvailable: () => printerFeatureService.isNativeAvailable(),
  requestBluetoothPermissions: () => printerFeatureService.requestBluetoothPermissions(),
  scanBluetoothPrinters: () => printerFeatureService.scanBluetoothPrinters(),
  /** Bytes only. Encoding lives in src/core/printing, shared with the web till. */
  printBytes: (device: PrinterDevice, bytes: Uint8Array) => printerFeatureService.printBytes(device, bytes),
};
