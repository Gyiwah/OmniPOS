import type { PrinterDevice, ReceiptPrintPayload } from "@/src/features/printer/types";
import { printerFeatureService } from "@/src/features/printer/service";

export type { PrinterDevice, ReceiptPrintPayload };

export const printerService = {
  isNativeAvailable: () => printerFeatureService.isNativeAvailable(),
  requestBluetoothPermissions: () => printerFeatureService.requestBluetoothPermissions(),
  scanBluetoothPrinters: () => printerFeatureService.scanBluetoothPrinters(),
  printReceipt: (device: PrinterDevice, payload: ReceiptPrintPayload, paperSize: "58mm" | "80mm") =>
    printerFeatureService.printReceipt(device, payload, paperSize),
  buildSampleReceipt: (storeName: string, paperSize: "58mm" | "80mm") =>
    printerFeatureService.buildSampleReceipt(storeName, paperSize),
};
