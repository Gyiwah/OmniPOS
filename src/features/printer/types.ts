export type PrinterConnectionType = "classic" | "ble";

export type PrinterDevice = {
  id: string;
  name: string;
  mac: string;
  address: string;
  connectionType: PrinterConnectionType;
};

export type ReceiptPrintLine = {
  id: string;
  name: string;
  quantity: number;
  price: number;
};

export type ReceiptPrintPayload = {
  storeName: string;
  orderNumber: string;
  dateLabel: string;
  currency: string;
  lines: ReceiptPrintLine[];
  discountMode: "percentage" | "amount";
  discountValue: number;
  amountPaid: number;
  customerName?: string | null;
  customerPhone?: string | null;
  shippingAddress?: string | null;
  taxRate: number;
  vatRate: number;
  serviceRate: number;
};

export type ScanPrintersResult = {
  devices: PrinterDevice[];
  nativeAvailable: boolean;
};
