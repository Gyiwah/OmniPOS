import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";

import { api, ApiError } from "@/api/client";
import { db, type LocalBatch, type LocalProduct } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { expiryStatus } from "./expiry";
import { addBatch, suggestBatchNumber } from "./service";

type Movement = {
  id: string;
  type: string;
  quantity: string;
  quantity_before: string;
  quantity_after: string;
  reason: string | null;
  notes: string | null;
  source_type: string | null;
  created_at: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  SALE: "Sold",
  RETURN: "Returned",
  STOCK_IN: "Received",
  STOCK_OUT: "Sent out",
  ADJUSTMENT: "Adjusted",
  DAMAGE: "Damaged",
  EXPIRED: "Expired",
  AUDIT: "Counted",
  TRANSFER_IN: "Transferred in",
  TRANSFER_OUT: "Transferred out",
};

type PriceChange = {
  id: string;
  old_sell_price: string;
  new_sell_price: string;
  old_cost_price: string | null;
  new_cost_price: string | null;
  reason: string | null;
  changed_by: string | null;
  at: string | null;
};

type Props = {
  product: LocalProduct;
  storeId: string;
  onClose: () => void;
};

/**
 * Where a product's stock actually came from and went.
 *
 * This is the answer to "why does it say 12 when there are 9 on the shelf",
 * which is otherwise unanswerable from a till. The ledger is the evidence and
 * the stock number is only a cache over it, so being able to read the ledger is
 * the difference between a figure a shop trusts and one it argues with.
 *
 * It needs a connection: the movements live on the server, and this device only
 * ever saw its own. That is the whole point — a local-only history would be the
 * same partial view that caused the disagreement.
 */
export function ProductDetail({ product, storeId, onClose }: Props) {
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const can = useSession((s) => s.can);

  const movements = useQuery({
    queryKey: ["product-movements", product.id],
    queryFn: () => api.get<{ data: Movement[] }>(`/api/products/${product.id}/movements`, { per_page: 50 }),
  });

  // Batches come from the local table, not the API: they are pulled with the
  // catalogue so expiry works offline, and reading them here from the same
  // place the inventory list reads them keeps the two from disagreeing.
  const batches = useLiveQuery(
    () => db.batches.where("product_id").equals(product.id).toArray(),
    [product.id],
    [] as LocalBatch[],
  );

  const priceHistory = useQuery({
    queryKey: ["price-history", product.id],
    queryFn: () => api.get<{ data: PriceChange[] }>(`/api/products/${product.id}/price-history`),
    enabled: can(["admin", "manager"]),
    retry: false,
  });

  const offline = movements.error instanceof ApiError && movements.error.isUnreachable;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`History for ${product.name}`}>
      <div className="modal modal-wide">
        <header className="conflict-head">
          <div>
            <h2>{product.name}</h2>
            <p className="muted mono">{product.sku}</p>
          </div>
          <div className="conflict-amount">
            {product.stock} on hand
          </div>
        </header>

        {can(["admin", "manager"]) && product.cost_price && (
          <p className="muted">
            Costs {formatMoney(toMinor(product.cost_price), currency)}, sells at{" "}
            {formatMoney(toMinor(product.price), currency)}
          </p>
        )}

        <h3 className="settings-subhead">Batches and expiry</h3>

        {batches.length > 0 ? (
          <table className="table">
            <thead><tr><th>Batch</th><th>Quantity</th><th>Cost</th><th>Expires</th><th /></tr></thead>
            <tbody>
              {batches
                .slice()
                // Soonest to expire first: that is the one somebody has to do
                // something about.
                .sort((a, b) => (a.expiry_date ?? "9999").localeCompare(b.expiry_date ?? "9999"))
                .map((b) => {
                  const info = expiryStatus(b.expiry_date);
                  return (
                    <tr key={b.id} className={info.status === "expired" ? "row-danger" : undefined}>
                      <td className="mono">{b.batch_number ?? "—"}</td>
                      <td>{Number(b.quantity)}</td>
                      <td>{b.cost_price ? formatMoney(toMinor(b.cost_price), currency) : "—"}</td>
                      <td className={info.status === "expired" ? "danger-text" : undefined}>{info.label}</td>
                      <td>{b._state === "pending" && <span className="pill pill-pending">Queued</span>}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        ) : (
          <p className="muted">No batches recorded. Add one to track an expiry date.</p>
        )}

        {can(["admin", "manager"]) && (
          <BatchForm
            storeId={storeId}
            productId={product.id}
            currency={currency}
            onSaved={() => void useSync.getState().sync(storeId)}
          />
        )}

        {priceHistory.data && priceHistory.data.data.length > 0 && (
          <>
            <h3 className="settings-subhead">Price changes</h3>
            <table className="table">
              <thead><tr><th>When</th><th>Sell</th><th>Cost</th><th>Why</th><th>Who</th></tr></thead>
              <tbody>
                {priceHistory.data.data.map((h) => {
                  const from = toMinor(h.old_sell_price);
                  const to = toMinor(h.new_sell_price);
                  return (
                    <tr key={h.id}>
                      <td>{h.at ? new Date(h.at).toLocaleDateString() : "—"}</td>
                      <td className={to > from ? "danger-text" : undefined}>
                        {formatMoney(from, currency)} → {formatMoney(to, currency)}
                      </td>
                      <td>
                        {h.old_cost_price && h.new_cost_price
                          ? `${formatMoney(toMinor(h.old_cost_price), currency)} → ${formatMoney(toMinor(h.new_cost_price), currency)}`
                          : "—"}
                      </td>
                      <td className="muted">{h.reason ?? "—"}</td>
                      <td>{h.changed_by ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        <h3 className="settings-subhead">Every movement</h3>

        {movements.isLoading && <p className="muted">Loading…</p>}

        {movements.error && (
          <p className="notice notice-warn">
            {offline
              ? "The movement history lives on the server, so it needs a connection. This device only ever saw its own."
              : movements.error instanceof Error
                ? movements.error.message
                : "Could not load the history."}
          </p>
        )}

        {movements.data && (
          <table className="table">
            <thead>
              <tr><th>When</th><th>What</th><th>Change</th><th>Left</th><th>Why</th></tr>
            </thead>
            <tbody>
              {movements.data.data.map((m) => {
                const change = Number(m.quantity);
                return (
                  <tr key={m.id}>
                    <td>{m.created_at ? new Date(m.created_at).toLocaleString() : "—"}</td>
                    <td>{TYPE_LABELS[m.type] ?? m.type}</td>
                    <td className={change < 0 ? "danger-text" : undefined}>
                      {change > 0 ? "+" : ""}{change}
                    </td>
                    <td>{Number(m.quantity_after)}</td>
                    <td className="muted">{m.notes || m.reason || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {movements.data?.data.length === 0 && (
          <p className="muted">Nothing has moved this product yet.</p>
        )}

        <div className="modal-actions">
          <span />
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Record a delivery with its own expiry date.
 *
 * "Also put it on the shelf" is on by default but separable, because the two
 * cases are genuinely different: goods received today are both a batch and a
 * stock movement, while a batch entered to backfill an expiry date for stock
 * already counted must not move anything.
 */
function BatchForm({
  storeId,
  productId,
  currency,
  onSaved,
}: {
  storeId: string;
  productId: string;
  currency: string;
  onSaved: () => void;
}) {
  const [batchNumber, setBatchNumber] = useState("");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [expiry, setExpiry] = useState("");
  const [addToStock, setAddToStock] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await addBatch({
        storeId,
        productId,
        batchNumber: batchNumber || null,
        quantity: Number(quantity),
        costPrice: cost.trim() === "" ? null : toMinor(cost),
        expiryDate: expiry || null,
        addToStock,
      });
      setBatchNumber("");
      setQuantity("");
      setCost("");
      setExpiry("");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the batch.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="batch-form" onSubmit={submit}>
      <input
        value={batchNumber}
        onChange={(e) => setBatchNumber(e.target.value)}
        placeholder={suggestBatchNumber(expiry || null)}
        aria-label="Batch number"
      />
      <input
        type="number"
        min={1}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        placeholder="Qty"
        aria-label="Batch quantity"
        className="qty-input"
        required
      />
      <input
        inputMode="decimal"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        placeholder={"Cost (" + currency + ")"}
        aria-label="Batch cost price"
        className="qty-input"
      />
      <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="Expiry date" />
      <label className="checkbox">
        <input type="checkbox" checked={addToStock} onChange={(e) => setAddToStock(e.target.checked)} />
        Add to stock
      </label>
      <button type="submit" className="secondary-button" disabled={busy || !quantity}>
        {busy ? "Saving…" : "Add batch"}
      </button>

      {error && <p className="notice notice-error" role="status">{error}</p>}
    </form>
  );
}
