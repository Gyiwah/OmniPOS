import { usePrinterStore } from "@/src/store/printerStore";

export function usePrinter() {
  return usePrinterStore((state) => ({
    connected: state.connected,
    deviceName: state.device?.name ?? null,
    device: state.device,
    paperSize: state.paperSize,
  }));
}
