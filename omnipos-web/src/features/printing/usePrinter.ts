import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  chooseBluetoothPrinter,
  chooseSerialPrinter,
  reconnectSerialPrinter,
  type PrinterTransport,
  type TransportKind,
} from "./transport";

type PrinterState = {
  /** Remembered so a till reconnects on reload without asking again. */
  preferred: TransportKind | null;
  width: 58 | 80;
  /** Whether the drawer is wired to the printer and should open on a cash sale. */
  openDrawer: boolean;

  connection: PrinterTransport | null;
  connecting: boolean;
  error: string | null;

  setWidth: (width: 58 | 80) => void;
  setOpenDrawer: (open: boolean) => void;
  connect: (kind: TransportKind) => Promise<void>;
  reconnect: () => Promise<void>;
  disconnect: () => Promise<void>;
  print: (bytes: Uint8Array) => Promise<void>;
};

/**
 * The printer this till is attached to.
 *
 * The connection itself is not persisted — a Web Serial port cannot be, and the
 * browser hands it back only after the user has chosen it once. What is
 * persisted is which kind was chosen and how wide the paper is, so reconnecting
 * on the next reload is silent.
 */
export const usePrinter = create<PrinterState>()(
  persist(
    (set, get) => ({
      preferred: null,
      width: 80,
      openDrawer: false,

      connection: null,
      connecting: false,
      error: null,

      setWidth: (width) => set({ width }),
      setOpenDrawer: (openDrawer) => set({ openDrawer }),

      async connect(kind) {
        set({ connecting: true, error: null });

        try {
          const connection = kind === "serial" ? await chooseSerialPrinter() : await chooseBluetoothPrinter();
          set({ connection, preferred: kind });
        } catch (error) {
          /*
           * Cancelling the browser's device picker throws. That is not a
           * failure worth showing — the person changed their mind.
           */
          const cancelled = error instanceof DOMException && error.name === "NotFoundError";

          set({ error: cancelled ? null : error instanceof Error ? error.message : "Could not connect." });
        } finally {
          set({ connecting: false });
        }
      },

      /** Silent on failure: this runs on load, and nobody asked for it. */
      async reconnect() {
        if (get().connection || get().preferred !== "serial") return;

        const connection = await reconnectSerialPrinter();
        if (connection) set({ connection });
      },

      async disconnect() {
        const { connection } = get();
        if (!connection) return;

        try {
          await connection.close();
        } catch {
          // Unplugged already. Nothing to recover.
        }

        set({ connection: null, preferred: null });
      },

      async print(bytes) {
        const { connection } = get();
        if (!connection) throw new Error("No printer is connected.");

        try {
          await connection.write(bytes);
        } catch (error) {
          /*
           * A printer unplugged mid-job leaves a connection that will never
           * work again, so it is dropped rather than left looking healthy.
           */
          set({ connection: null, error: error instanceof Error ? error.message : "The printer stopped responding." });
          throw error;
        }
      },
    }),
    {
      name: "omnipos.printer",
      partialize: (s) => ({ preferred: s.preferred, width: s.width, openDrawer: s.openDrawer }),
    },
  ),
);
