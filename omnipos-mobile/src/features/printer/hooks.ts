import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSettingsStore } from "@/src/store/settingsStore";
import { usePrinterStore } from "@/src/store/printerStore";

import { printerFeatureService } from "./service";
import type { PrinterDevice, ReceiptPrintPayload } from "./types";

export function usePrinterAvailability() {
  return {
    nativeAvailable: printerFeatureService.isNativeAvailable(),
  };
}

export function useBluetoothPrinters(enabled = false) {
  return useQuery({
    queryKey: ["bluetooth-printers"],
    queryFn: () => printerFeatureService.scanBluetoothPrinters(),
    enabled,
    staleTime: 15_000,
  });
}

export function usePairPrinter() {
  const setPrinter = usePrinterStore((s) => s.setPrinter);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (device: PrinterDevice) => {
      await printerFeatureService.testConnection(device);
      return device;
    },
    onSuccess: (device) => {
      setPrinter(device);
      void queryClient.invalidateQueries({ queryKey: ["bluetooth-printers"] });
    },
  });
}

export function usePrintReceipt() {
  const device = usePrinterStore((s) => s.device);
  const paperSize = usePrinterStore((s) => s.paperSize);

  return useMutation({
    mutationFn: (payload: ReceiptPrintPayload) => {
      if (!device) throw new Error("No Bluetooth printer is paired.");
      return printerFeatureService.printReceipt(device, payload, paperSize);
    },
  });
}

export function useTestPrint() {
  const device = usePrinterStore((s) => s.device);
  const paperSize = usePrinterStore((s) => s.paperSize);
  const shopName = useSettingsStore((s) => s.shopName);

  return useMutation({
    mutationFn: () => {
      if (!device) throw new Error("No Bluetooth printer is paired.");
      const payload = printerFeatureService.buildSampleReceipt(shopName, paperSize);
      return printerFeatureService.printReceipt(device, payload, paperSize);
    },
  });
}
