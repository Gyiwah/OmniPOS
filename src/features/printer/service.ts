import { PermissionsAndroid, Platform } from "react-native";

import type { PrinterDevice, PrinterConnectionType, ReceiptPrintPayload, ScanPrintersResult } from "./types";
import { buildReceiptPrintJob } from "./buildReceiptJob";

type NativeScanRow = {
  name?: string;
  address?: string;
  macAddress?: string;
};

type ThermalPrinterModule = {
  scanDevices: () => Promise<{ paired?: NativeScanRow[]; found?: NativeScanRow[] }>;
  printReceipt: (job: ReturnType<typeof buildReceiptPrintJob>) => Promise<unknown>;
  testConnection?: (address: string) => Promise<boolean>;
};

function loadThermalPrinter(): ThermalPrinterModule | null {
  try {
    // Native module is unavailable in Expo Go.
    const mod = require("@finan-me/react-native-thermal-printer") as { ThermalPrinter?: ThermalPrinterModule };
    return mod.ThermalPrinter ?? null;
  } catch {
    return null;
  }
}

function normalizeMac(value: string): string {
  return value.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

function formatMac(value: string): string {
  const clean = normalizeMac(value);
  if (clean.length !== 12) return value.toUpperCase();
  return clean.match(/.{1,2}/g)?.join(":") ?? value.toUpperCase();
}

function inferConnectionType(address: string): PrinterConnectionType {
  return address.startsWith("ble:") ? "ble" : "classic";
}

function toPrinterAddress(mac: string, connectionType: PrinterConnectionType): string {
  const formatted = formatMac(mac);
  return connectionType === "ble" ? `ble:${formatted}` : `bt:${formatted}`;
}

function mapScanRow(row: NativeScanRow, fallbackType: PrinterConnectionType): PrinterDevice | null {
  const rawAddress = row.address ?? row.macAddress ?? "";
  const mac = formatMac(rawAddress.replace(/^(bt|ble):/i, ""));
  if (!mac) return null;

  const connectionType = rawAddress.startsWith("ble:") ? "ble" : fallbackType;
  const address = rawAddress.includes(":") && /^(bt|ble):/i.test(rawAddress) ? rawAddress : toPrinterAddress(mac, connectionType);
  const name = row.name?.trim() || "Bluetooth printer";

  return {
    id: normalizeMac(mac),
    name,
    mac,
    address,
    connectionType,
  };
}

function dedupeDevices(devices: PrinterDevice[]): PrinterDevice[] {
  const seen = new Set<string>();
  return devices.filter((device) => {
    if (seen.has(device.id)) return false;
    seen.add(device.id);
    return true;
  });
}

export const printerFeatureService = {
  isNativeAvailable(): boolean {
    return loadThermalPrinter() !== null;
  },

  async requestBluetoothPermissions(): Promise<boolean> {
    if (Platform.OS !== "android") return true;

    if (Platform.Version >= 31) {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return (
        granted["android.permission.BLUETOOTH_SCAN"] === PermissionsAndroid.RESULTS.GRANTED &&
        granted["android.permission.BLUETOOTH_CONNECT"] === PermissionsAndroid.RESULTS.GRANTED
      );
    }

    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  },

  async scanBluetoothPrinters(): Promise<ScanPrintersResult> {
    const native = loadThermalPrinter();
    if (!native) {
      return { devices: [], nativeAvailable: false };
    }

    const allowed = await this.requestBluetoothPermissions();
    if (!allowed) {
      throw new Error("Bluetooth permissions are required to scan for receipt printers.");
    }

    const result = await native.scanDevices();
    const paired = (result.paired ?? []).map((row) => mapScanRow(row, "classic")).filter(Boolean) as PrinterDevice[];
    const found = (result.found ?? []).map((row) => mapScanRow(row, "ble")).filter(Boolean) as PrinterDevice[];

    return {
      devices: dedupeDevices([...paired, ...found]),
      nativeAvailable: true,
    };
  },

  async testConnection(device: PrinterDevice): Promise<boolean> {
    const native = loadThermalPrinter();
    if (!native) {
      throw new Error("Bluetooth printing requires a development build. Expo Go is not supported.");
    }
    if (native.testConnection) {
      return native.testConnection(device.address);
    }
    return true;
  },

  async printReceipt(
    device: PrinterDevice,
    payload: ReceiptPrintPayload,
    paperSize: "58mm" | "80mm",
  ): Promise<void> {
    const native = loadThermalPrinter();
    if (!native) {
      throw new Error("Bluetooth printing requires a development build. Expo Go is not supported.");
    }

    const paperWidthMm = paperSize === "58mm" ? 58 : 80;
    const job = buildReceiptPrintJob(payload, paperWidthMm, device.address);

    await native.printReceipt(job);
  },

  buildSampleReceipt(storeName: string, paperSize: "58mm" | "80mm"): ReceiptPrintPayload {
    return {
      storeName,
      orderNumber: "TEST-001",
      dateLabel: new Date().toLocaleString(),
      currency: "GHS",
      lines: [
        { id: "1", name: "Sample Item A", quantity: 1, price: 25 },
        { id: "2", name: "Sample Item B", quantity: 2, price: 10 },
      ],
      discountMode: "percentage",
      discountValue: 0,
      amountPaid: 45,
      customerName: "Walk-in customer",
      customerPhone: null,
      shippingAddress: null,
      taxRate: 0,
      vatRate: 0,
      serviceRate: 0,
    };
  },
};
