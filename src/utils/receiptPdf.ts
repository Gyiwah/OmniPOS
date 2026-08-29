import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Alert } from "react-native";
import type { ReceiptData } from "@/src/components/organisms/ReceiptDocument";

export type ReceiptPdfProps = {
  shopName: string;
  orderNumber: string;
  dateLabel: string;
  data: ReceiptData;
};

export function buildReceiptHtml({ shopName, orderNumber, dateLabel, data }: ReceiptPdfProps): string {
  const sym = data.currency === "USD" ? "$" : data.currency === "NGN" ? "₦" : "₵";
  const subtotal = data.lines.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
  const discount =
    data.discountMode === "percentage"
      ? subtotal * ((Number(data.discountValue) || 0) / 100)
      : Number(data.discountValue) || 0;
  const base = Math.max(0, subtotal - discount);
  const tax = base * ((Number(data.taxRate) || 0) / 100);
  const vat = base * ((Number(data.vatRate) || 0) / 100);
  const service = base * ((Number(data.serviceRate) || 0) / 100);
  const grandTotal = base + tax + vat + service;
  const amountPaid = Number(data.amountPaid) || 0;
  const change = Math.max(0, amountPaid - grandTotal);

  const itemsHtml = data.lines
    .map(
      (item) => `
      <tr>
        <td style="padding: 8px 4px; font-weight: 600; color: #1e293b;">
          ${item.name}
          <div style="font-size: 11px; color: #64748b; font-weight: 400;">
            ${item.quantity} x ${sym}${Number(item.price).toFixed(2)}
          </div>
        </td>
        <td style="padding: 8px 4px; text-align: right; font-weight: 700; color: #0f172a;">
          ${sym}${(Number(item.price) * Number(item.quantity)).toFixed(2)}
        </td>
      </tr>
    `
    )
    .join("");

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Receipt ${orderNumber}</title>
        <style>
          @page {
            margin: 12mm;
            size: auto;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            color: #1e293b;
            background: #ffffff;
            margin: 0;
            padding: 10px;
            font-size: 13px;
            line-height: 1.4;
          }
          .receipt-box {
            max-width: 380px;
            margin: 0 auto;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 24px 20px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
          }
          .header {
            text-align: center;
            border-bottom: 2px dashed #cbd5e1;
            padding-bottom: 16px;
            margin-bottom: 16px;
          }
          .store-name {
            font-size: 22px;
            font-weight: 800;
            letter-spacing: -0.5px;
            color: #0f172a;
            margin: 0 0 4px 0;
            text-transform: uppercase;
          }
          .receipt-badge {
            display: inline-block;
            background: #eff6ff;
            color: #2563eb;
            font-size: 11px;
            font-weight: 700;
            padding: 3px 10px;
            border-radius: 20px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 4px;
          }
          .meta-section {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: #64748b;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid #f1f5f9;
          }
          .meta-col-left { text-align: left; }
          .meta-col-right { text-align: right; }
          .meta-highlight {
            font-weight: 700;
            color: #0f172a;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
          }
          th {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #94a3b8;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 6px;
          }
          .breakdown {
            border-top: 1px solid #e2e8f0;
            padding-top: 12px;
            margin-bottom: 16px;
          }
          .row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 6px;
            font-size: 12px;
            color: #475569;
          }
          .grand-total-box {
            background: #0f172a;
            color: #ffffff;
            border-radius: 8px;
            padding: 12px 14px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin: 12px 0;
          }
          .grand-total-label {
            font-size: 14px;
            font-weight: 600;
            color: #e2e8f0;
          }
          .grand-total-value {
            font-size: 20px;
            font-weight: 800;
            color: #ffffff;
          }
          .payment-info {
            background: #f8fafc;
            border-radius: 8px;
            padding: 10px 12px;
            margin-bottom: 16px;
            border: 1px solid #edf2f7;
          }
          .customer-box {
            border: 1px solid #f1f5f9;
            border-radius: 8px;
            padding: 10px 12px;
            margin-bottom: 16px;
            font-size: 12px;
          }
          .customer-title {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            color: #94a3b8;
            margin-bottom: 4px;
          }
          .barcode-wrap {
            text-align: center;
            margin: 16px 0 8px 0;
            padding: 12px 0;
            border-top: 2px dashed #cbd5e1;
          }
          .barcode-bars {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 2px;
            height: 36px;
            margin-bottom: 6px;
          }
          .bar {
            background: #0f172a;
            height: 100%;
            border-radius: 1px;
          }
          .footer {
            text-align: center;
            font-size: 11px;
            color: #94a3b8;
          }
          .footer-thanks {
            font-weight: 700;
            color: #475569;
            font-size: 12px;
            margin-bottom: 4px;
          }
        </style>
      </head>
      <body>
        <div class="receipt-box">
          <div class="header">
            <h1 class="store-name">${shopName || "OmniPOS Store"}</h1>
            <div class="receipt-badge">Sales Receipt</div>
          </div>

          <div class="meta-section">
            <div class="meta-col-left">
              <div>Order No: <span class="meta-highlight">#${orderNumber}</span></div>
              <div>Date: ${dateLabel}</div>
            </div>
            <div class="meta-col-right">
              <div>Status: <span style="color: #16a34a; font-weight: 700;">Completed</span></div>
              <div>Currency: <span class="meta-highlight">${data.currency || "GHS"}</span></div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="text-align: left;">Item</th>
                <th style="text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div class="breakdown">
            <div class="row">
              <span>Subtotal</span>
              <span>${sym}${subtotal.toFixed(2)}</span>
            </div>
            ${
              discount > 0
                ? `
              <div class="row" style="color: #ea580c;">
                <span>Discount ${data.discountMode === "percentage" ? `(${data.discountValue}%)` : ""}</span>
                <span>-${sym}${discount.toFixed(2)}</span>
              </div>
            `
                : ""
            }
            ${
              tax > 0
                ? `
              <div class="row">
                <span>Tax (${data.taxRate}%)</span>
                <span>${sym}${tax.toFixed(2)}</span>
              </div>
            `
                : ""
            }
            ${
              vat > 0
                ? `
              <div class="row">
                <span>VAT (${data.vatRate}%)</span>
                <span>${sym}${vat.toFixed(2)}</span>
              </div>
            `
                : ""
            }
            ${
              service > 0
                ? `
              <div class="row">
                <span>Service Charge (${data.serviceRate}%)</span>
                <span>${sym}${service.toFixed(2)}</span>
              </div>
            `
                : ""
            }
          </div>

          <div class="grand-total-box">
            <span class="grand-total-label">Grand Total</span>
            <span class="grand-total-value">${sym}${grandTotal.toFixed(2)}</span>
          </div>

          <div class="payment-info">
            <div class="row" style="margin-bottom: 4px;">
              <span style="font-weight: 600;">Amount Paid</span>
              <span style="font-weight: 700; color: #0f172a;">${sym}${amountPaid.toFixed(2)}</span>
            </div>
            <div class="row" style="margin: 0;">
              <span style="font-weight: 600;">Change Due</span>
              <span style="font-weight: 700; color: #16a34a;">${sym}${change.toFixed(2)}</span>
            </div>
          </div>

          ${
            data.customerName || data.customerPhone || data.shippingAddress
              ? `
            <div class="customer-box">
              <div class="customer-title">Customer Information</div>
              ${data.customerName ? `<div><strong>Name:</strong> ${data.customerName}</div>` : ""}
              ${data.customerPhone ? `<div><strong>Phone:</strong> ${data.customerPhone}</div>` : ""}
              ${data.shippingAddress ? `<div><strong>Address:</strong> ${data.shippingAddress}</div>` : ""}
            </div>
          `
              : ""
          }

          <div class="barcode-wrap">
            <div class="barcode-bars">
              <div class="bar" style="width: 3px;"></div>
              <div class="bar" style="width: 1px;"></div>
              <div class="bar" style="width: 4px;"></div>
              <div class="bar" style="width: 2px;"></div>
              <div class="bar" style="width: 1px;"></div>
              <div class="bar" style="width: 3px;"></div>
              <div class="bar" style="width: 2px;"></div>
              <div class="bar" style="width: 4px;"></div>
              <div class="bar" style="width: 1px;"></div>
              <div class="bar" style="width: 2px;"></div>
              <div class="bar" style="width: 3px;"></div>
              <div class="bar" style="width: 1px;"></div>
              <div class="bar" style="width: 4px;"></div>
              <div class="bar" style="width: 2px;"></div>
              <div class="bar" style="width: 3px;"></div>
              <div class="bar" style="width: 1px;"></div>
              <div class="bar" style="width: 2px;"></div>
              <div class="bar" style="width: 4px;"></div>
            </div>
            <div style="font-family: monospace; font-size: 11px; letter-spacing: 2px; color: #64748b;">
              *${orderNumber}*
            </div>
          </div>

          <div class="footer">
            <div class="footer-thanks">Thank you for your business!</div>
            <div>Powered by OmniPOS Point of Sale</div>
          </div>
        </div>
      </body>
    </html>
  `;
}

export async function shareReceiptAsPdf(props: ReceiptPdfProps): Promise<void> {
  try {
    const html = buildReceiptHtml(props);
    const { uri } = await Print.printToFileAsync({
      html,
      base64: false,
    });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        dialogTitle: `Receipt #${props.orderNumber}.pdf`,
        UTI: "com.adobe.pdf",
      });
    } else {
      Alert.alert("Sharing unavailable", "PDF sharing is not supported on this device.");
    }
  } catch (error) {
    Alert.alert("PDF Error", error instanceof Error ? error.message : "Failed to generate receipt PDF.");
  }
}
