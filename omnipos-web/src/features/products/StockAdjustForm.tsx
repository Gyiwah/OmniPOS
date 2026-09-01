import { useState } from "react";

import type { LocalProduct } from "@/db/schema";
import { adjustStock } from "./service";

/**
 * Only types the server's check constraint accepts. AUDIT is the stock take —
 * the count that corrects the books to what is physically on the shelf.
 */
const TYPES = [
  { value: "STOCK_IN", label: "Delivery received", direction: 1 },
  { value: "AUDIT", label: "Stock take correction", direction: 0 },
  { value: "DAMAGE", label: "Damaged", direction: -1 },
  { value: "EXPIRED", label: "Expired", direction: -1 },
  { value: "ADJUSTMENT", label: "Other adjustment", direction: 1 },
] as const;

type Props = {
  storeId: string;
  product: LocalProduct;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Move stock for one product.
 *
 * A stock take is entered as the counted total and converted to a delta here,
 * because the ledger stores movements, not totals. That conversion is the whole
 * point: if this till's figure was stale, posting the delta still leaves the
 * ledger consistent with every other terminal's movements, whereas posting an
 * absolute total would silently erase sales made elsewhere.
 */
export function StockAdjustForm({ storeId, product, onClose, onSaved }: Props) {
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("STOCK_IN");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isStockTake = type === "AUDIT";
  const entered = Number(quantity);
  const delta = isStockTake ? entered - product.stock : entered * (TYPES.find((t) => t.value === type)?.direction || 1);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await adjustStock({
        storeId,
        productId: product.id,
        delta,
        type,
        reason: reason.trim() || (TYPES.find((t) => t.value === type)?.label ?? "Adjustment"),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the movement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Adjust stock">
      <form className="modal" onSubmit={submit}>
        <h2>Adjust stock</h2>
        <p className="muted">{product.name} · currently {product.stock}</p>

        <label htmlFor="s-type">What happened</label>
        <select id="s-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <label htmlFor="s-qty">{isStockTake ? "Counted on the shelf" : "Quantity"}</label>
        <input
          id="s-qty"
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          autoFocus
          required
        />

        {quantity !== "" && Number.isFinite(delta) && (
          <p className={delta === 0 ? "notice notice-warn" : "notice notice-ok"}>
            {delta === 0
              ? "That matches what the till already believes — nothing to record."
              : `Records a movement of ${delta > 0 ? "+" : ""}${delta}, leaving ${product.stock + delta}.`}
          </p>
        )}

        <label htmlFor="s-reason">Reason</label>
        <input
          id="s-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional note for whoever reviews the ledger"
        />

        {error && <p className="notice notice-error" role="status">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="link" onClick={onClose}>Cancel</button>
          <button type="submit" className="pay-button" disabled={busy || delta === 0 || quantity === ""}>
            {busy ? "Recording…" : "Record movement"}
          </button>
        </div>
      </form>
    </div>
  );
}
