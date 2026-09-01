import { useQuery } from "@tanstack/react-query";

import { api, ApiError } from "@/api/client";
import type { LocalProduct } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";

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

type Batch = {
  id: string;
  batch_number: string | null;
  quantity: string;
  cost_price: string | null;
  expiry_date: string | null;
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

type Props = {
  product: LocalProduct;
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
export function ProductDetail({ product, onClose }: Props) {
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const can = useSession((s) => s.can);

  const movements = useQuery({
    queryKey: ["product-movements", product.id],
    queryFn: () => api.get<{ data: Movement[] }>(`/api/products/${product.id}/movements`, { per_page: 50 }),
  });

  const batches = useQuery({
    queryKey: ["product-batches", product.id],
    queryFn: () => api.get<{ data: Batch[] }>("/api/inventory/batches", { product_id: product.id, per_page: 50 }),
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

        {(batches.data?.data.length ?? 0) > 0 && (
          <>
            <h3 className="settings-subhead">Batches</h3>
            <table className="table">
              <thead><tr><th>Batch</th><th>Quantity</th><th>Cost</th><th>Expires</th></tr></thead>
              <tbody>
                {batches.data?.data.map((b) => {
                  const expiry = b.expiry_date ? new Date(b.expiry_date) : null;
                  const expired = expiry !== null && expiry < new Date();
                  return (
                    <tr key={b.id} className={expired ? "row-warn" : undefined}>
                      <td className="mono">{b.batch_number ?? "—"}</td>
                      <td>{Number(b.quantity)}</td>
                      <td>{b.cost_price ? formatMoney(toMinor(b.cost_price), currency) : "—"}</td>
                      <td className={expired ? "danger-text" : undefined}>
                        {expiry ? expiry.toLocaleDateString() : "—"}
                        {expired && " (expired)"}
                      </td>
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
