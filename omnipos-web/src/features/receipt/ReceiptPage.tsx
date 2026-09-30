import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api } from "@/api/client";
import { db, type LocalOrder } from "@/db/schema";
import { getCurrencySymbol, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { buildReceipt } from "@/features/printing/receipt";
import { usePrinter } from "@/features/printing/usePrinter";

function barcodePattern(value: string) {
  const patterns: Record<string, number[]> = {
    "-": [1, 2, 2, 1, 3, 2], O: [3, 3, 1, 1, 2, 1], M: [1, 1, 3, 1, 2, 3],
    "0": [1, 2, 3, 1, 2, 2], "1": [1, 2, 3, 2, 2, 1], "2": [2, 2, 3, 2, 1, 1],
    "3": [2, 2, 1, 1, 3, 2], "4": [2, 2, 1, 2, 3, 1], "5": [2, 1, 3, 2, 1, 2],
    "6": [2, 2, 3, 1, 1, 2], "7": [3, 1, 2, 1, 3, 1], "8": [3, 1, 1, 2, 2, 2],
    "9": [3, 2, 1, 1, 2, 2],
  };
  const text = value.trim() || "000000";
  const codes = Array.from(text, (character) => character === "O" ? 47 : character === "M" ? 45 : character === "-" ? 13 : 16 + Number(character));
  const checksum = (104 + codes.reduce((sum, code, index) => sum + (index + 1) * code, 0)) % 103;
  const segments: number[] = [2, 1, 1, 2, 1, 4];
  for (const character of text) segments.push(...(patterns[character] ?? patterns["0"]));
  const checksumPatterns: Record<number, number[]> = {
    0: [2, 1, 2, 2, 2, 2], 1: [2, 2, 2, 1, 2, 2], 2: [2, 2, 2, 2, 2, 1],
    3: [1, 2, 1, 2, 2, 3], 4: [1, 2, 1, 3, 2, 2], 5: [1, 3, 1, 2, 2, 2],
    6: [1, 2, 2, 2, 1, 3], 7: [1, 2, 2, 3, 1, 2], 8: [1, 3, 2, 2, 1, 2],
    9: [2, 2, 1, 2, 1, 3], 10: [2, 2, 1, 3, 1, 2], 11: [2, 3, 1, 2, 1, 2],
    12: [1, 1, 2, 2, 3, 2], 13: [1, 2, 2, 1, 3, 2], 14: [1, 2, 2, 2, 3, 1],
    15: [1, 1, 3, 2, 2, 2], 16: [1, 2, 3, 1, 2, 2], 17: [1, 2, 3, 2, 2, 1],
    18: [2, 2, 3, 2, 1, 1], 19: [2, 2, 1, 1, 3, 2], 20: [2, 2, 1, 2, 3, 1],
    21: [2, 1, 3, 2, 1, 2], 22: [2, 2, 3, 1, 1, 2], 23: [3, 1, 2, 1, 3, 1],
    24: [3, 1, 1, 2, 2, 2], 25: [3, 2, 1, 1, 2, 2], 45: [1, 1, 3, 1, 2, 3],
    47: [3, 3, 1, 1, 2, 1],
  };
  segments.push(...(checksumPatterns[checksum] ?? patterns["0"]));
  segments.push(2, 3, 3, 1, 1, 1, 2);
  return segments;
}

function receiptSymbol(currency: string): string {
  return getCurrencySymbol(currency);
}

function receiptMoney(minor: number, currency: string): string {
  const symbol = getCurrencySymbol(currency);
  const space = symbol.length > 1 ? " " : "";
  const absolute = Math.abs(Math.round(minor));
  const value = `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
  return `${symbol}${space}${minor < 0 ? "-" : ""}${value}`;
}

/**
 * A printable receipt. Use the local record first so a just-completed offline
 * sale is immediate; fetch server details only when this till has no copy.
 */
export function ReceiptPage() {
  const { orderId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const store = useSession((s) => s.store);
  const user = useSession((s) => s.user);
  const currency = store?.currency ?? "GHS";

  const localOrder = useLiveQuery(async () => (await db.orders.get(orderId)) ?? null, [orderId], undefined);
  const remoteOrder = useQuery({
    queryKey: ["order-receipt", store?.id, orderId],
    enabled: Boolean(orderId && localOrder === null),
    queryFn: async (): Promise<LocalOrder> => {
      const response = await api.get<{
        data: {
          id: string;
          store_id: string;
          order_number: string;
          status: string;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          register_shift_id: string | null;
          subtotal: string;
          tax: string;
          discount: string;
          total: string;
          amount_paid: string;
          change_due: string;
          payment_method: string;
          client_created_at: string | null;
          created_at: string | null;
          items?: Array<{
            id: string;
            product_id: string | null;
            product_name: string;
            sku: string | null;
            barcode: string | null;
            unit_price: string;
            quantity: number;
            line_total: string;
            unit_cost?: string | null;
          }>;
          payments?: Array<{
            id: string;
            method: string;
            amount: string;
            reference: string | null;
          }>;
        };
      }>(`/api/orders/${orderId}`);
      const record = response.data;

      return {
        id: record.id,
        store_id: record.store_id,
        order_number: record.order_number,
        status: record.status,
        customer_id: record.customer_id,
        customer_name: record.customer_name,
        customer_phone: record.customer_phone,
        register_shift_id: record.register_shift_id,
        subtotal: record.subtotal,
        tax: record.tax,
        discount: record.discount,
        total: record.total,
        amount_paid: record.amount_paid,
        change_due: record.change_due,
        payment_method: record.payment_method,
        items: (record.items ?? []).map((item) => ({ ...item, unit_cost: item.unit_cost ?? null })),
        payments: record.payments ?? [],
        client_created_at: record.client_created_at ?? record.created_at ?? new Date().toISOString(),
        _state: "clean",
      };
    },
  });
  const order = localOrder === undefined ? undefined : localOrder ?? remoteOrder.data ?? null;

  const connection = usePrinter((s) => s.connection);
  const paperWidth = usePrinter((s) => s.width);
  const sendToPrinter = usePrinter((s) => s.print);
  const drawerOnCash = usePrinter((s) => s.openDrawer);
  const [printError, setPrintError] = useState<string | null>(null);
  const [reprinted, setReprinted] = useState(false);

  /**
   * Straight to the thermal printer when one is attached, and through the
   * browser when not. A cashier should not have to know which is happening.
   */
  const printNow = useCallback(
    async (reprint: boolean) => {
      if (!order) return;

      if (!connection) {
        window.print();
        return;
      }

      setPrintError(null);
      try {
        await sendToPrinter(
          buildReceipt(order, {
            storeName: store?.name ?? "OmniPOS",
            currency,
            cashierName: user?.name ?? null,
            width: paperWidth,
            reprint,
            // Only when cash actually changed hands. A card sale that popped
            // the drawer would leave it open with nothing going into it.
            openDrawer: drawerOnCash && order.payments.some((p) => p.method === "cash"),
          }),
        );
        if (reprint) setReprinted(true);
      } catch (e) {
        setPrintError(e instanceof Error ? e.message : "The printer did not respond.");
      }
    },
    [order, connection, sendToPrinter, store?.name, currency, user?.name, paperWidth, drawerOnCash],
  );

  // `?print=1` is set when a sale has just completed, so the dialog opens
  // without a second click. Reopening an old receipt does not print itself.
  const autoPrint = params.get("print") === "1";

  useEffect(() => {
    if (order && autoPrint) {
      // A moment for the page to lay out before the browser dialog opens; the
      // thermal path does not need it but sharing the delay keeps one branch.
      const timer = window.setTimeout(() => void printNow(false), 150);
      return () => window.clearTimeout(timer);
    }
  }, [order, autoPrint, printNow]);

  if (localOrder === undefined || (localOrder === null && remoteOrder.isLoading)) {
    return <div className="page"><p className="muted">Loading receipt…</p></div>;
  }

  if (order === null) {
    return (
      <div className="page">
        <h1>Receipt</h1>
        <p className="notice notice-warn">
          {remoteOrder.isError
            ? "This receipt could not be loaded. Check the connection and retry."
            : "That sale is not available on this till."}
        </p>
        {remoteOrder.isError && <button type="button" className="secondary-button" onClick={() => void remoteOrder.refetch()}>Retry</button>}
        <button type="button" className="secondary-button" onClick={() => navigate("/orders")}>Back to orders</button>
      </div>
    );
  }

  if (order === undefined) return null;

  const change = toMinor(order.change_due);

  return (
    <div className="page receipt-page">
      <div className="receipt-toolbar no-print">
        <button type="button" className="pay-button" onClick={() => void printNow(true)}>
          {connection ? "Print on the till printer" : "Print"}
        </button>
        {connection && (
          <button type="button" className="secondary-button" onClick={() => window.print()}>
            Use the browser instead
          </button>
        )}
        <button type="button" className="secondary-button" onClick={() => navigate("/orders")}>Back to orders</button>
      </div>

      {printError && <p className="receipt-toast receipt-toast-error no-print" role="status">{printError}</p>}
      {reprinted && (
        <p className="receipt-toast receipt-toast-ok no-print" role="status">
          Sent. It is marked as a reprint, so it cannot be mistaken for a second sale.
        </p>
      )}

      <article className="receipt">
        <header className="receipt-head">
          <h1>{store?.name ?? "OmniPOS Store"}</h1>
          <div className="receipt-badge">SALES RECEIPT</div>
        </header>

        <div className="receipt-meta">
          <div>
            <span>Order No: <strong>#{order.order_number}</strong></span>
            <span>Date: {new Date(order.client_created_at).toLocaleString()}</span>
          </div>
          <div>
            <span>Status: <strong className="receipt-status">Completed</strong></span>
            <span>Currency: <strong>{currency} ({receiptSymbol(currency)})</strong></span>
          </div>
        </div>

        <table className="receipt-lines">
          <thead>
            <tr>
              <th>Item</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.product_name}
                  <span className="receipt-qty">
                    {item.quantity} × {receiptMoney(toMinor(item.unit_price), currency)}
                  </span>
                </td>
                <td className="receipt-amount">{receiptMoney(toMinor(item.line_total), currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="receipt-divider" />

        <dl className="receipt-summary">
          <div><dt>Subtotal</dt><dd>{receiptMoney(toMinor(order.subtotal), currency)}</dd></div>
          {toMinor(order.discount) > 0 && (
            <div className="receipt-discount"><dt>Discount</dt><dd>-{receiptMoney(toMinor(order.discount), currency)}</dd></div>
          )}
          {toMinor(order.tax) > 0 && <div><dt>Tax</dt><dd>{receiptMoney(toMinor(order.tax), currency)}</dd></div>}
        </dl>

        <div className="receipt-total">
          <strong>Grand Total ({currency})</strong>
          <strong>{receiptMoney(toMinor(order.total), currency)}</strong>
        </div>

        <dl className="receipt-payment">
          <div><dt>Amount Paid</dt><dd>{receiptMoney(toMinor(order.amount_paid), currency)}</dd></div>
          <div><dt>Change Due</dt><dd className="receipt-change">{receiptMoney(change, currency)}</dd></div>
        </dl>

        {(order.customer_name || order.customer_phone) && (
          <div className="receipt-customer">
            <strong>Customer Information</strong>
            {order.customer_name && <span><b>Name:</b> {order.customer_name}</span>}
            {order.customer_phone && <span><b>Phone:</b> {order.customer_phone}</span>}
          </div>
        )}

        {/*
          Printed on the receipt, not just shown on screen. A cashier handing
          this to a customer during an outage should be able to see that the
          sale has not reached the books yet — and so should whoever reconciles
          it later.
        */}
        {order._state === "pending" && (
          <p className="receipt-flag">Recorded offline · awaiting sync</p>
        )}
        {order._state === "conflict" && (
          <p className="receipt-flag">This sale was rejected by the server and needs a manager.</p>
        )}

        <div className="receipt-barcode" aria-label={`Barcode for ${order.order_number}`}>
          <div className="receipt-barcode-bars">
            {barcodePattern(order.order_number).map((width, index) => (
              <i key={`${order.order_number}-${index}`} style={{ flexGrow: width }} />
            ))}
          </div>
          <span>*{order.order_number}*</span>
        </div>

        <footer className="receipt-foot">
          <strong>Thank you for your business!</strong>
          <span>Powered by OmniPOS Point of Sale</span>
        </footer>
      </article>
    </div>
  );
}
