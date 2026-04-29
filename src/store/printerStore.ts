import { create } from "zustand";

type PrinterState = {
  connected: boolean;
  deviceName: string | null;
  setPrinter: (connected: boolean, deviceName?: string | null) => void;
};

export const usePrinterStore = create<PrinterState>((set) => ({
  connected: false,
  deviceName: null,
  setPrinter: (connected, deviceName = null) => set({ connected, deviceName }),
}));
