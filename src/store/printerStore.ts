import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "@/src/core/platform";

import type { PrinterDevice } from "@/src/features/printer/types";

type PrinterState = {
  connected: boolean;
  device: PrinterDevice | null;
  paperSize: "58mm" | "80mm";
  autoPrintReceipts: boolean;
  autoCutPaper: boolean;
  footerMessage: string;
  setPrinter: (device: PrinterDevice | null) => void;
  setPaperSize: (size: "58mm" | "80mm") => void;
  setAutoPrintReceipts: (enabled: boolean) => void;
  setAutoCutPaper: (enabled: boolean) => void;
  setFooterMessage: (message: string) => void;
};

export const usePrinterStore = create<PrinterState>()(
  persist(
    (set) => ({
      connected: false,
      device: null,
      paperSize: "80mm",
      autoPrintReceipts: true,
      autoCutPaper: true,
      footerMessage: "Thank you for your business!",
      setPrinter: (device) =>
        set({
          device,
          connected: Boolean(device),
        }),
      setPaperSize: (paperSize) => set({ paperSize }),
      setAutoPrintReceipts: (autoPrintReceipts) => set({ autoPrintReceipts }),
      setAutoCutPaper: (autoCutPaper) => set({ autoCutPaper }),
      setFooterMessage: (footerMessage) => set({ footerMessage }),
    }),
    {
      name: "omnipos-printer-v1",
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({
        connected: s.connected,
        device: s.device,
        paperSize: s.paperSize,
        autoPrintReceipts: s.autoPrintReceipts,
        autoCutPaper: s.autoCutPaper,
        footerMessage: s.footerMessage,
      }),
    },
  ),
);
