import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSettingsStore } from "@/src/store/settingsStore";
import { usePrinterStore } from "@/src/store/printerStore";

import { printerFeatureService } from "./service";
import { buildReceipt, buildTestPrint, type PrintableReceipt } from "@/src/core/printing/receipt";
import type { PrinterDevice } from "./types";

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

/**
 * Print a sale.
 *
 * The receipt is encoded here, from the figures the sale was booked at, and the
 * service only carries the bytes. Encoding and transport were tangled before,
 * which is how the layout ended up recomputing tax from the store's current
 * rates instead of printing what the customer paid.
 */
export function usePrintReceipt() {
  const device = usePrinterStore((s) => s.device);
  const paperSize = usePrinterStore((s) => s.paperSize);
  const shopName = useSettingsStore((s) => s.shopName);
  const shopEmail = useSettingsStore((s) => s.shopEmail);
  const currency = useSettingsStore((s) => s.currency);

  return useMutation({
    mutationFn: ({ receipt, reprint }: { receipt: PrintableReceipt; reprint?: boolean }) => {
      if (!device) throw new Error("No Bluetooth printer is paired.");

      const bytes = buildReceipt(receipt, {
        storeName: shopName,
        storeEmail: shopEmail || null,
        currency,
        width: paperSize === "58mm" ? 58 : 80,
        reprint,
      });

      return printerFeatureService.printBytes(device, bytes);
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

      const bytes = buildTestPrint({ storeName: shopName, width: paperSize === "58mm" ? 58 : 80 });

      return printerFeatureService.printBytes(device, bytes);
    },
  });
}
