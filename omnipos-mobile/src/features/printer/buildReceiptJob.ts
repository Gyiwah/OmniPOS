import type { ReceiptPrintPayload } from "./types";

type PrintBlock =
  | { type: "text"; content: string; style?: { align?: "left" | "center" | "right"; bold?: boolean; size?: string } }
  | { type: "line" }
  | {
      type: "columns";
      columns: { content: string; width: number; align?: "left" | "center" | "right" }[];
    }
  | { type: "feed"; lines: number }
  | { type: "cut"; partial?: boolean };

function currencySymbol(code: string) {
  if (code === "USD") return "$";
  if (code === "NGN") return "₦";
  return "₵";
}

export function buildReceiptPrintJob(payload: ReceiptPrintPayload, paperWidthMm: 58 | 80, address?: string) {
  const sym = currencySymbol(payload.currency);
  const subtotal = payload.lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const discount =
    payload.discountMode === "percentage" ? subtotal * (payload.discountValue / 100) : payload.discountValue;
  const base = Math.max(0, subtotal - discount);
  const tax = base * (payload.taxRate / 100);
  const vat = base * (payload.vatRate / 100);
  const service = base * (payload.serviceRate / 100);
  const total = base + tax + vat + service;
  const change = Math.max(0, payload.amountPaid - total);

  const blocks: PrintBlock[] = [
    { type: "text", content: payload.storeName, style: { align: "center", bold: true, size: "double_width" } },
    { type: "text", content: "RECEIPT", style: { align: "center", bold: true } },
    { type: "text", content: payload.dateLabel, style: { align: "center" } },
    { type: "text", content: `Ref ${payload.orderNumber}`, style: { align: "center" } },
    { type: "line" },
  ];

  for (const line of payload.lines) {
    blocks.push({
      type: "columns",
      columns: [
        { content: `${line.quantity}x ${line.name}`, width: 70 },
        { content: `${sym}${(line.price * line.quantity).toFixed(2)}`, width: 30, align: "right" },
      ],
    });
  }

  blocks.push(
    { type: "line" },
    {
      type: "columns",
      columns: [
        { content: "Subtotal", width: 60 },
        { content: `${sym}${subtotal.toFixed(2)}`, width: 40, align: "right" },
      ],
    },
    {
      type: "columns",
      columns: [
        { content: "Discount", width: 60 },
        {
          content:
            payload.discountMode === "percentage"
              ? `${payload.discountValue}%`
              : `${sym}${payload.discountValue.toFixed(2)}`,
          width: 40,
          align: "right",
        },
      ],
    },
    {
      type: "columns",
      columns: [
        { content: `Tax ${payload.taxRate}%`, width: 60 },
        { content: tax.toFixed(2), width: 40, align: "right" },
      ],
    },
    {
      type: "columns",
      columns: [
        { content: `VAT ${payload.vatRate}%`, width: 60 },
        { content: vat.toFixed(2), width: 40, align: "right" },
      ],
    },
    {
      type: "columns",
      columns: [
        { content: `Service ${payload.serviceRate}%`, width: 60 },
        { content: service.toFixed(2), width: 40, align: "right" },
      ],
    },
    {
      type: "columns",
      columns: [
        { content: "TOTAL", width: 60 },
        { content: `${sym}${total.toFixed(2)}`, width: 40, align: "right" },
      ],
    },
    {
      type: "columns",
      columns: [
        { content: "Paid", width: 60 },
        { content: `${sym}${payload.amountPaid.toFixed(2)}`, width: 40, align: "right" },
      ],
    },
    {
      type: "columns",
      columns: [
        { content: "Change", width: 60 },
        { content: `${sym}${change.toFixed(2)}`, width: 40, align: "right" },
      ],
    },
    { type: "line" },
    { type: "text", content: "Customer", style: { bold: true } },
    { type: "text", content: `Name: ${payload.customerName || "—"}` },
    { type: "text", content: `Phone: ${payload.customerPhone || "—"}` },
    { type: "text", content: `Address: ${payload.shippingAddress || "—"}` },
    { type: "feed", lines: 3 },
    { type: "text", content: "Thank you for shopping with us.", style: { align: "center" } },
    { type: "feed", lines: 3 },
    { type: "cut", partial: true },
  );

  return {
    printers: [
      {
        ...(address ? { address } : {}),
        options: {
          paperWidthMm,
          encoding: "UTF8" as const,
          marginMm: 1,
        },
      },
    ],
    documents: [blocks],
  };
}
