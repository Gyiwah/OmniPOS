import { useState } from "react";

import { formatMoney, toMinor } from "@/features/pos/cart";
import type { LocalOrder, SyncOperation } from "@/db/schema";

type Props = {
  operation: SyncOperation;
  order?: LocalOrder;
  currency: string;
  canResolve: boolean;
  busy: boolean;
  onReissue: () => void;
  onRetry: () => void;
  onDiscard: () => void;
};

/**
 * One conflict, with enough context to decide.
 *
 * A reason string alone is not enough to settle a sale. The manager needs to see
 * what was actually rung up — total, lines, when, and which receipt number — or
 * the only safe choice is to do nothing.
 */
export function ConflictCard({
  operation,
  order,
  currency,
  canResolve,
  busy,
  onReissue,
  onRetry,
  onDiscard,
}: Props) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Only a receipt-number clash can be settled by re-issuing; other causes need
  // the underlying problem fixed first.
  const isNumberClash = /order number/i.test(operation.last_error ?? "");

  return (
    <article className="conflict-card">
      <header className="conflict-head">
        <div>
          <h3>
            {order ? order.order_number : operation.entity}
            {order && <span className="conflict-amount">{formatMoney(toMinor(order.total), currency)}</span>}
          </h3>
          <p className="conflict-reason">{operation.last_error}</p>
        </div>
        <span className="pill pill-offline">Not on the books</span>
      </header>

      {order && (
        <div className="conflict-detail">
          <dl>
            <div><dt>Rung up</dt><dd>{new Date(order.client_created_at).toLocaleString()}</dd></div>
            <div><dt>Items</dt><dd>{order.items.length}</dd></div>
            <div><dt>Paid</dt><dd>{formatMoney(toMinor(order.amount_paid), currency)}</dd></div>
            <div><dt>Customer</dt><dd>{order.customer_name ?? "Walk-in"}</dd></div>
          </dl>
          <ul className="conflict-lines">
            {order.items.map((item) => (
              <li key={item.id}>
                <span>{item.quantity} × {item.product_name}</span>
                <span>{formatMoney(toMinor(item.line_total), currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!canResolve ? (
        <p className="muted">A manager or admin can settle this.</p>
      ) : (
        <footer className="conflict-actions">
          {isNumberClash && (
            <button type="button" className="pay-button" disabled={busy} onClick={onReissue}>
              Re-issue under a new receipt number
            </button>
          )}
          <button type="button" className="secondary-button" disabled={busy} onClick={onRetry}>
            Try again as-is
          </button>

          {confirmDiscard ? (
            <span className="confirm-inline">
              <span className="muted">Discard this sale? It stays on this device but never reaches the books.</span>
              <button type="button" className="link danger" disabled={busy} onClick={onDiscard}>
                Yes, discard
              </button>
              <button type="button" className="link" onClick={() => setConfirmDiscard(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="link danger" disabled={busy} onClick={() => setConfirmDiscard(true)}>
              Discard
            </button>
          )}
        </footer>
      )}

      {isNumberClash && canResolve && (
        <p className="conflict-hint">
          Both sales are real — another till issued this number while this one was offline. Re-issuing keeps both
          and books this one under the next free number.
        </p>
      )}
    </article>
  );
}
