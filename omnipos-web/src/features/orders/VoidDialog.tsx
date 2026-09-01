import { useState } from "react";

import type { LocalOrder } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { voidOrder } from "./void";

type Props = {
  order: LocalOrder;
  currency: string;
  onClose: () => void;
  onVoided: () => void;
};

export function VoidDialog({ order, currency, onClose, onVoided }: Props) {
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const paid = toMinor(order.amount_paid);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await voidOrder({ orderId: order.id, reason, restock });
      onVoided();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not void this sale.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Void this sale">
      <form className="modal" onSubmit={submit}>
        <h2>Void {order.order_number}</h2>
        <p className="muted">
          {formatMoney(toMinor(order.total), currency)} ·{" "}
          {new Date(order.client_created_at).toLocaleString()}
        </p>

        {/*
          The money is the part people forget. Voiding does not open a drawer or
          send anything back to a card machine — it only corrects the books, and
          somebody still has to hand the cash over.
        */}
        {paid > 0 && (
          <p className="notice notice-warn">
            {formatMoney(paid, currency)} was taken for this sale. Voiding does not return it — refund the customer
            separately, or use Returns if they are bringing goods back.
          </p>
        )}

        <label htmlFor="void-reason">Reason</label>
        <input
          id="void-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Rung up twice, wrong customer, test sale…"
          autoFocus
          required
        />

        <label className="checkbox">
          <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
          Put the items back on the shelf
        </label>
        <p className="conflict-hint">
          Leave this off when the goods never came back — a sale entered twice moved stock once, not twice.
        </p>

        {error && <p className="notice notice-error" role="status">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="link" onClick={onClose}>Cancel</button>
          <button type="submit" className="pay-button" disabled={busy || !reason.trim()}>
            {busy ? "Voiding…" : "Void this sale"}
          </button>
        </div>
      </form>
    </div>
  );
}
