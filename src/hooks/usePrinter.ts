import { usePrinterStore } from "@/src/store/printerStore";

export function usePrinter() {
  return usePrinterStore((state) => ({
    connected: state.connected,
    deviceName: state.deviceName,
  }));
}
