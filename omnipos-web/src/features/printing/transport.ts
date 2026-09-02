/**
 * Getting bytes to a thermal printer from a browser.
 *
 * A browser cannot open a TCP socket, so a network printer on port 9100 is out
 * of reach without a helper running on the till — which is a second thing to
 * install and keep running, and the reason this was left until last. What a
 * browser can do is talk to hardware the person has explicitly handed it:
 *
 *   Web Serial    — a USB printer that presents as a serial port. The common
 *                   case for a counter-top printer, and the most reliable.
 *   Web Bluetooth — a portable BLE printer. Works, but slowly: BLE caps at
 *                   ~20 bytes a write, so a receipt is several hundred writes.
 *
 * Both require a user gesture to choose the device, and both remember the
 * choice per origin afterwards. Neither exists in Firefox or Safari, which is
 * why the browser print path stays and this is offered alongside it.
 */

export type TransportKind = "serial" | "bluetooth";

export type PrinterTransport = {
  kind: TransportKind;
  label: string;
  write: (bytes: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
};

/** What this browser can actually do. Checked before anything is offered. */
export function printingSupport(): { serial: boolean; bluetooth: boolean } {
  return {
    serial: typeof navigator !== "undefined" && "serial" in navigator,
    bluetooth: typeof navigator !== "undefined" && "bluetooth" in navigator,
  };
}

export function anyPrintingSupport(): boolean {
  const support = printingSupport();
  return support.serial || support.bluetooth;
}

// ---------------------------------------------------------------- serial

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  writable: WritableStream<Uint8Array> | null;
  getInfo: () => { usbVendorId?: number; usbProductId?: number };
};

type SerialLike = {
  requestPort: () => Promise<SerialPortLike>;
  getPorts: () => Promise<SerialPortLike[]>;
};

function serial(): SerialLike | null {
  return (navigator as unknown as { serial?: SerialLike }).serial ?? null;
}

/**
 * 9600 is the near-universal default for these printers and the only rate that
 * works without configuring the device. A printer set faster still prints at
 * 9600; one set slower is rare enough not to guess at.
 */
const BAUD_RATE = 9600;

async function openSerialPort(port: SerialPortLike): Promise<PrinterTransport> {
  await port.open({ baudRate: BAUD_RATE });

  const info = port.getInfo();
  const label = info.usbVendorId
    ? `USB printer ${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)}`
    : "USB printer";

  return {
    kind: "serial",
    label,
    async write(bytes) {
      if (!port.writable) throw new Error("The printer port is not writable.");

      const writer = port.writable.getWriter();
      try {
        await writer.write(bytes);
      } finally {
        // Released rather than closed: closing the writer closes the stream,
        // and the port would then need reopening for the next receipt.
        writer.releaseLock();
      }
    },
    close: () => port.close(),
  };
}

/** Prompts for a port. Must be called from a click — the browser requires it. */
export async function chooseSerialPrinter(): Promise<PrinterTransport> {
  const api = serial();
  if (!api) throw new Error("This browser has no Web Serial. Use Chrome or Edge, or print through the browser instead.");

  return openSerialPort(await api.requestPort());
}

/**
 * A port this origin was already granted, so a till reconnects on reload
 * without asking the cashier to pick the printer every morning.
 */
export async function reconnectSerialPrinter(): Promise<PrinterTransport | null> {
  const api = serial();
  if (!api) return null;

  const [port] = await api.getPorts();
  if (!port) return null;

  try {
    return await openSerialPort(port);
  } catch {
    // Already open in another tab, or unplugged since it was granted.
    return null;
  }
}

// ---------------------------------------------------------------- bluetooth

type BluetoothLike = {
  requestDevice: (options: unknown) => Promise<{
    name?: string;
    gatt?: {
      connect: () => Promise<{
        getPrimaryService: (uuid: string) => Promise<{
          getCharacteristic: (uuid: string) => Promise<{
            writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
            writeValue: (value: BufferSource) => Promise<void>;
          }>;
        }>;
        disconnect: () => void;
      }>;
    };
  }>;
};

/**
 * The service nearly every BLE thermal printer exposes.
 *
 * There is no standard for this — printers borrowed a serial-port profile UUID
 * and it became the convention. A printer using a different one has to be added
 * here; there is no way to discover it generically.
 */
const PRINTER_SERVICE = "000018f0-0000-1000-8000-00805f9b34fb";
const PRINTER_CHARACTERISTIC = "00002af1-0000-1000-8000-00805f9b34fb";

/** BLE caps a single write at 20 bytes on many stacks. A receipt is chunked. */
const BLE_CHUNK = 20;

export async function chooseBluetoothPrinter(): Promise<PrinterTransport> {
  const api = (navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth;
  if (!api) throw new Error("This browser has no Web Bluetooth. Use Chrome or Edge, or print through the browser.");

  const device = await api.requestDevice({
    filters: [{ services: [PRINTER_SERVICE] }],
    optionalServices: [PRINTER_SERVICE],
  });

  const server = await device.gatt?.connect();
  if (!server) throw new Error("Could not connect to that printer.");

  const service = await server.getPrimaryService(PRINTER_SERVICE);
  const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC);

  return {
    kind: "bluetooth",
    label: device.name ?? "Bluetooth printer",
    async write(bytes) {
      for (let offset = 0; offset < bytes.length; offset += BLE_CHUNK) {
        const chunk = bytes.slice(offset, offset + BLE_CHUNK);

        /*
         * Without-response where the printer allows it: an acknowledged write
         * per 20 bytes makes a receipt take the better part of a minute. Fall
         * back when the characteristic does not support it.
         */
        if (characteristic.writeValueWithoutResponse) {
          await characteristic.writeValueWithoutResponse(chunk);
        } else {
          await characteristic.writeValue(chunk);
        }
      }
    },
    async close() {
      server.disconnect();
    },
  };
}
