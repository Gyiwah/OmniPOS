export type PrinterConnectionType = "classic" | "ble" | "network";

export type PrinterDevice = {
  id: string;
  name: string;
  mac: string;
  address: string;
  connectionType: PrinterConnectionType;
};

export type ScanPrintersResult = {
  devices: PrinterDevice[];
  nativeAvailable: boolean;
};
