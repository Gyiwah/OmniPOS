import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

type PrinterDevice = {
  id: string;
  name: string;
  mac: string;
};

type PrinterState = {
  connected: boolean;
  device: PrinterDevice | null;
  paperSize: "58mm" | "80mm";
  setPrinter: (device: PrinterDevice | null) => void;
  setPaperSize: (size: "58mm" | "80mm") => void;
};

export const usePrinterStore = create<PrinterState>()(
  persist(
    (set) => ({
      connected: false,
      device: null,
      paperSize: "80mm",
      setPrinter: (device) =>
        set({
          device,
          connected: Boolean(device),
        }),
      setPaperSize: (paperSize) => set({ paperSize }),
    }),
    {
      name: "omnipos-printer-v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        connected: s.connected,
        device: s.device,
        paperSize: s.paperSize,
      }),
    },
  ),
);
