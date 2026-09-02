import { NativeModules, PermissionsAndroid, Platform } from "react-native";

import type { PrinterDevice, PrinterConnectionType, ScanPrintersResult } from "./types";

type NativeScanRow = {
  name?: string;
  address?: string;
  macAddress?: string;
};

type ThermalPrinterModule = {
  scanDevices: () => Promise<{ paired?: NativeScanRow[]; found?: NativeScanRow[] }>;
  testConnection?: (address: string) => Promise<boolean>;
  /**
   * Bytes, straight to the printer.
   *
   * Used in preference to the library's own printReceipt, which takes a block
   * format of its own invention and does the ESC/POS encoding itself. Sending
   * bytes means the layout is ours, is shared with the web till, and is covered
   * by tests that assert the actual bytes — none of which is true of a format
   * only the library understands.
   */
  NativePrinter?: {
    printRaw: (address: string, data: number[], options?: Record<string, unknown>) => Promise<unknown>;
  };
};

function loadThermalPrinter(): ThermalPrinterModule | null {
  // If the native module or react-native-fs native bridge is unavailable (e.g. running in Expo Go),
  // do NOT require the library because react-native-fs throws RNFSFileTypeRegular null error at module load.
  if (!NativeModules?.RNThermalPrinter || !NativeModules?.RNFSManager) {
    return null;
  }

  try {
    const mod = require("@finan-me/react-native-thermal-printer") as {
      ThermalPrinter?: Omit<ThermalPrinterModule, "NativePrinter"> & {
        NativePrinter?: ThermalPrinterModule["NativePrinter"];
      };
    };
    return (mod.ThermalPrinter as ThermalPrinterModule) ?? null;
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

  /**
   * Send an already-encoded receipt.
   *
   * The bytes come from src/core/printing, which the web till uses unchanged —
   * so a shop with a phone and a browser hands out the same document from both,
   * and the layout is covered by tests rather than by whatever a library does
   * with a block format.
   */
  async printBytes(device: PrinterDevice, bytes: Uint8Array): Promise<void> {
    const native = loadThermalPrinter();
    if (!native) {
      throw new Error("Bluetooth printing requires a development build. Expo Go is not supported.");
    }

    if (!native.NativePrinter?.printRaw) {
      throw new Error("This printer module cannot send raw bytes. Update the app.");
    }

    // The bridge takes a plain array; a typed array does not survive it.
    await native.NativePrinter.printRaw(device.address, Array.from(bytes));
  },

};
