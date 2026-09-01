import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type LocalProduct } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { Link } from "react-router-dom";
import { ProductDetail } from "./ProductDetail";
import { ProductForm } from "./ProductForm";
import { StockAdjustForm } from "./StockAdjustForm";

/**
 * Inventory list, served from the local catalogue so it works offline.
 *
 * Cost price is shown only to roles the API would disclose it to, and only
 * those roles may edit the catalogue. The server is the real gate in both cases
 * — it omits cost for a cashier and its product handler refuses their writes —
 * so this is presentation consistency rather than a security boundary.
 */
export function ProductsPage() {
  const storeId = useSession((s) => s.storeId);
  const can = useSession((s) => s.can);
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const showCost = can(["admin", "manager"]);

  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<LocalProduct | "new" | null>(null);
  const [adjusting, setAdjusting] = useState<LocalProduct | null>(null);
  const [inspecting, setInspecting] = useState<LocalProduct | null>(null);

  // Only admins and managers may write products; the server's handler refuses
  // a cashier outright, so offering them the button would only produce a
  // conflict an hour later.
  const canEdit = can(["admin", "manager"]);
  const afterWrite = () => {
    setEditing(null);
    setAdjusting(null);
    if (storeId) void useSync.getState().sync(storeId);
  };

  const products = useLiveQuery(
    async () => {
      if (!storeId) return [];
      const needle = query.trim().toLowerCase();
      let rows = await db.products.where("store_id").equals(storeId).toArray();
      if (needle) rows = rows.filter((p) => p.search_key.includes(needle) || p.barcode === needle);
      if (lowOnly) rows = rows.filter((p) => p.stock <= p.reorder_level);
      return rows.sort((a, b) => a.name.localeCompare(b.name));
    },
    [storeId, query, lowOnly],
    [] as LocalProduct[],
  );

  return (
    <div className="page">
      <header className="page-header">
        <h1>Inventory</h1>
        <div className="page-actions">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, SKU or barcode"
            aria-label="Search inventory"
          />
          <label className="checkbox">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            Low stock only
          </label>
          {canEdit && (
            <>
              <Link to="/stock-take" className="secondary-button">Stock take</Link>
              <button type="button" className="pay-button" onClick={() => setEditing("new")}>Add product</button>
            </>
          )}
        </div>
      </header>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th><th>SKU</th><th>Price</th>
            {showCost && <th>Cost</th>}
            <th>Stock</th><th>Reorder at</th>
            {canEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className={p.stock <= p.reorder_level ? "row-warn" : undefined}>
              <td>{p.name}</td>
              <td className="mono">{p.sku}</td>
              <td>{formatMoney(toMinor(p.price), currency)}</td>
              {showCost && <td>{p.cost_price ? formatMoney(toMinor(p.cost_price), currency) : "—"}</td>}
              <td className={p.stock < 0 ? "danger-text" : undefined}>{p.stock}</td>
              <td className="muted">{p.reorder_level}</td>
              {canEdit && (
                <td className="row-actions">
                  {/* The ledger answers "why does it say 12 when there are 9
                      on the shelf", which is otherwise unanswerable here. */}
                  <button type="button" className="link" onClick={() => setInspecting(p)}>History</button>
                  <button type="button" className="link" onClick={() => setEditing(p)}>Edit</button>
                  <button type="button" className="link" onClick={() => setAdjusting(p)}>Adjust stock</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {products.length === 0 && <p className="muted">Nothing to show. Sync to download the catalogue.</p>}

      {editing && storeId && (
        <ProductForm
          storeId={storeId}
          currency={currency}
          product={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={afterWrite}
        />
      )}

      {inspecting && <ProductDetail product={inspecting} onClose={() => setInspecting(null)} />}

      {adjusting && storeId && (
        <StockAdjustForm
          storeId={storeId}
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={afterWrite}
        />
      )}
    </div>
  );
}
