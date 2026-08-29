import { useShallow } from "zustand/react/shallow";
import { usePrinterStore } from "@/src/store/printerStore";

export function usePrinter() {
  return usePrinterStore(
    useShallow((state) => ({
      connected: state.connected,
      deviceName: state.device?.name ?? null,
      device: state.device,
      paperSize: state.paperSize,
    }))
  );
}
