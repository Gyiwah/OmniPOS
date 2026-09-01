import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { db } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  transfer: "Transfer",
  mobile_money: "Mobile money",
  split: "Split",
};

/**
 * A printable receipt.
 *
 * Rendered from the local order, never fetched, because the moment a receipt is
 * most needed is immediately after the sale — when the operation may still be
 * sitting in the outbox. Printing through the browser rather than a driver keeps
 * this working on whatever hardware the shop already has; a thermal printer on
 * the network is set up as the default printer and the page size does the rest.
 */
export function ReceiptPage() {
  const { orderId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const store = useSession((s) => s.store);
  const user = useSession((s) => s.user);
  const currency = store?.currency ?? "GHS";

  const order = useLiveQuery(() => db.orders.get(orderId), [orderId], undefined);

  // `?print=1` is set when a sale has just completed, so the dialog opens
  // without a second click. Reopening an old receipt does not print itself.
  const autoPrint = params.get("print") === "1";

  useEffect(() => {
    if (order && autoPrint) {
      const timer = window.setTimeout(() => window.print(), 150);
      return () => window.clearTimeout(timer);
    }
  }, [order, autoPrint]);

  if (order === undefined) {
    return <div className="page"><p className="muted">Loading receipt…</p></div>;
  }

  if (order === null) {
    return (
      <div className="page">
        <h1>Receipt</h1>
        <p className="notice notice-warn">
          That sale is not on this till. Receipts are held by the terminal that rang them up.
        </p>
        <button type="button" className="secondary-button" onClick={() => navigate("/orders")}>Back to orders</button>
      </div>
    );
  }

  const owed = toMinor(order.total) - toMinor(order.amount_paid);
  const change = toMinor(order.change_due);

  return (
    <div className="page receipt-page">
      <div className="receipt-toolbar no-print">
        <button type="button" className="pay-button" onClick={() => window.print()}>Print</button>
        <button type="button" className="secondary-button" onClick={() => navigate("/orders")}>Back to orders</button>
      </div>

      <article className="receipt">
        <header className="receipt-head">
          <h1>{store?.name ?? "OmniPOS"}</h1>
          <p className="mono">{order.order_number}</p>
          <p>{new Date(order.client_created_at).toLocaleString()}</p>
          {user && <p className="muted">Served by {user.name}</p>}
        </header>

        <table className="receipt-lines">
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.product_name}
                  <span className="receipt-qty">
                    {item.quantity} × {formatMoney(toMinor(item.unit_price), currency)}
                  </span>
                </td>
                <td className="receipt-amount">{formatMoney(toMinor(item.line_total), currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="receipt-totals">
          <div><dt>Subtotal</dt><dd>{formatMoney(toMinor(order.subtotal), currency)}</dd></div>
          {toMinor(order.discount) > 0 && (
            <div><dt>Discount</dt><dd>−{formatMoney(toMinor(order.discount), currency)}</dd></div>
          )}
          {toMinor(order.tax) > 0 && <div><dt>Tax</dt><dd>{formatMoney(toMinor(order.tax), currency)}</dd></div>}
          <div className="receipt-grand"><dt>Total</dt><dd>{formatMoney(toMinor(order.total), currency)}</dd></div>
        </dl>

        <dl className="receipt-totals">
          {order.payments.map((p) => (
            <div key={p.id}>
              <dt>{METHOD_LABELS[p.method] ?? p.method}</dt>
              <dd>{formatMoney(toMinor(p.amount), currency)}</dd>
            </div>
          ))}
          {change > 0 && <div><dt>Change</dt><dd>{formatMoney(change, currency)}</dd></div>}
          {owed > 0 && (
            <div className="receipt-grand">
              <dt>Balance on account</dt>
              <dd>{formatMoney(owed, currency)}</dd>
            </div>
          )}
        </dl>

        {order.customer_name && <p className="receipt-customer">Customer: {order.customer_name}</p>}

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

        <footer className="receipt-foot">
          <p>Thank you</p>
        </footer>
      </article>
    </div>
  );
}
