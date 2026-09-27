import { useState } from "react";
import { AlertTriangle, X, RotateCcw, AlertOctagon } from "lucide-react";

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
  const total = toMinor(order.total);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) return;
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
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Void this sale" onClick={onClose}>
      <form className="modal" style={{ width: "min(32rem, 100%)" }} onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--line)", paddingBottom: "0.75rem" }}>
          <div>
            <h2 style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--danger)", display: "flex", alignItems: "center", gap: "0.45rem" }}>
              <AlertOctagon size={20} />
              <span>Void Sale {order.order_number}</span>
            </h2>
            <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.78rem" }}>
              {formatMoney(total, currency)} · {new Date(order.client_created_at).toLocaleString()}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>

        {paid > 0 && (
          <div className="action-alert-banner alert-warn-theme" role="status" style={{ margin: "0.4rem 0" }}>
            <div className="alert-left-content">
              <div className="alert-icon-wrap">
                <AlertTriangle size={18} />
              </div>
              <div className="alert-text-stack">
                <strong>Physical Tender Reversal Notice</strong>
                <small>
                  {formatMoney(paid, currency)} was accepted for this sale. Voiding reverses the accounting record and restores shelf stock, but does NOT disburse physical cash from the till drawer or reverse card terminals automatically.
                </small>
              </div>
            </div>
          </div>
        )}

        <div className="settings-field-group">
          <label className="settings-label" htmlFor="void-reason">
            Reason for Voiding <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <input
            id="void-reason"
            className="settings-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Rung up twice, wrong customer, till training sale…"
            autoFocus
            required
          />
          <span className="settings-field-hint">
            Logged permanently in store audit logs for inventory and tax reconciliations.
          </span>
        </div>

        <div className="switch-toggle-card" style={{ marginTop: "0.2rem" }}>
          <div className="switch-label-block">
            <strong>Restock Items to Shelf Catalogue</strong>
            <small>
              Increments inventory stock levels back onto active store batches. Leave off if items were damaged or not returned.
            </small>
          </div>
          <input
            type="checkbox"
            className="toggle-switch-input"
            checked={restock}
            onChange={(e) => setRestock(e.target.checked)}
            aria-label="Restock items to shelf"
          />
        </div>

        {error && (
          <div className="action-alert-banner alert-danger-theme" role="status">
            <div className="alert-left-content">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: "0.5rem" }}>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="pay-button"
            style={{ background: "var(--danger)", color: "#ffffff", boxShadow: "0 4px 14px rgba(220, 38, 38, 0.3)" }}
            disabled={busy || !reason.trim()}
          >
            <RotateCcw size={15} />
            <span>{busy ? "Voiding Sale…" : "Confirm Void"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
