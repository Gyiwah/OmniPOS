import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, ClipboardList, Download, Package, Plus } from "lucide-react";

import { db, type LocalBatch, type LocalProduct } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import {
  countByFilter,
  matchesFilter,
  matchesQuery,
  worstBatchExpiry,
  type InventoryRow,
  type StockFilter,
} from "./expiry";
import { exportInventoryCsv } from "./exportCsv";
import { ProductDetail } from "./ProductDetail";
import { ProductForm } from "./ProductForm";
import { StockAdjustForm } from "./StockAdjustForm";

const FILTERS: Array<{ key: StockFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "in_stock", label: "In stock" },
  { key: "low", label: "Low" },
  { key: "expiring_soon", label: "Expiring" },
  { key: "expired", label: "Expired" },
  { key: "out", label: "Out" },
];

/**
 * Inventory, served from the local catalogue so it works offline.
 *
 * Expiry is computed here from the batches this device holds, using the same
 * thirty-day threshold the mobile app uses — a manager who checks stock on a
 * phone and then on a browser must not be told two different things about the
 * same shelf.
 *
 * Cost price is shown only to roles the API would disclose it to, and only
 * those roles may edit the catalogue. The server is the real gate in both cases,
 * so this is presentation consistency rather than a security boundary.
 */
export function ProductsPage() {
  const storeId = useSession((s) => s.storeId);
  const can = useSession((s) => s.can);
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const storeName = useSession((s) => s.store?.name) ?? "OmniPOS";
  const showCost = can(["admin", "manager"]);
  const canEdit = can(["admin", "manager"]);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [editing, setEditing] = useState<LocalProduct | "new" | null>(null);
  const [adjusting, setAdjusting] = useState<LocalProduct | null>(null);
  const [inspecting, setInspecting] = useState<LocalProduct | null>(null);

  const afterWrite = () => {
    setEditing(null);
    setAdjusting(null);
    if (storeId) void useSync.getState().sync(storeId);
  };

  // One pass over products and batches, joined here rather than per row: a
  // lookup per product would be a full table scan per row on a big catalogue.
  const rows = useLiveQuery(
    async () => {
      if (!storeId) return [];

      const [products, batches] = await Promise.all([
        db.products.where("store_id").equals(storeId).toArray(),
        db.batches.where("store_id").equals(storeId).toArray(),
      ]);

      const byProduct = new Map<string, LocalBatch[]>();
      for (const batch of batches) {
        const list = byProduct.get(batch.product_id);
        if (list) list.push(batch);
        else byProduct.set(batch.product_id, [batch]);
      }

      return products
        .map((product) => ({ product, expiry: worstBatchExpiry(byProduct.get(product.id) ?? []) }))
        .sort((a, b) => a.product.name.localeCompare(b.product.name));
    },
    [storeId],
    [] as InventoryRow[],
  );

  const counts = useMemo(() => countByFilter(rows), [rows]);
  const visible = useMemo(
    () => rows.filter((r) => matchesFilter(r, filter) && matchesQuery(r, query)),
    [rows, filter, query],
  );

  return (
    <div className="page">
      <header className="page-header">
        <h1><Package size={20} aria-hidden="true" /> Inventory</h1>
        <div className="page-actions">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, SKU, barcode or tag"
            aria-label="Search inventory"
          />
          <button
            type="button"
            className="secondary-button"
            disabled={rows.length === 0}
            onClick={() => exportInventoryCsv(rows, storeName, currency)}
          >
            <Download size={16} aria-hidden="true" />
            Export CSV
          </button>
          {canEdit && (
            <>
              <Link to="/stock-take" className="secondary-button">
                <ClipboardList size={16} aria-hidden="true" />
                Stock take
              </Link>
              <button type="button" className="pay-button" onClick={() => setEditing("new")}>
                <Plus size={17} aria-hidden="true" />
                Add product
              </button>
            </>
          )}
        </div>
      </header>

      {/*
        Expired stock is on a shelf now, so it leads. The banner is a shortcut
        to the filter rather than a second list — one place where the answer
        lives, reachable in a click.
      */}
      {(counts.expired > 0 || counts.expiring_soon > 0) && filter !== "expired" && filter !== "expiring_soon" && (
        <p className="notice notice-warn">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
          {counts.expired > 0 && `${counts.expired} ${counts.expired === 1 ? "product has" : "products have"} expired stock`}
          {counts.expired > 0 && counts.expiring_soon > 0 && " · "}
          {counts.expiring_soon > 0 && `${counts.expiring_soon} expiring within 30 days`}
          {". "}
          <button
            type="button"
            className="link"
            onClick={() => setFilter(counts.expired > 0 ? "expired" : "expiring_soon")}
          >
            Show them
          </button>
          </span>
        </p>
      )}

      <div className="pos-categories">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={f.key === filter ? "chip chip-active" : "chip"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {/* The count is the point: "Low 4" is actionable, "Low" is a
                question you have to click to answer. */}
            <span className="chip-count">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {/* Wide tables scroll inside their own box. Without this the whole
          page scrolls sideways on a tablet, and the filter chips and header
          slide off with it. */}
      <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th />
            <th>Name</th><th>SKU</th><th>Price</th>
            {showCost && <th>Cost</th>}
            <th>Stock</th><th>Expiry</th>
            {canEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {visible.map(({ product: p, expiry }) => {
            const low = p.stock > 0 && p.stock <= p.reorder_level;
            return (
              <tr key={p.id} className={expiry?.status === "expired" ? "row-danger" : low ? "row-warn" : undefined}>
                <td>
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="product-thumb" loading="lazy" />
                  ) : (
                    // Initial rather than a generic box: at a glance down a long
                    // list it still distinguishes one row from the next.
                    <span className="product-thumb product-thumb-empty" aria-hidden="true">
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </td>
                <td>
                  {p.name}
                  {!p.is_active && <span className="pill pill-discarded">Not for sale</span>}
                  {p.tags.length > 0 && (
                    <span className="tag-row">
                      {p.tags.map((t) => <span key={t} className="tag">{t}</span>)}
                    </span>
                  )}
                </td>
                <td className="mono">{p.sku}</td>
                <td>{formatMoney(toMinor(p.price), currency)}</td>
                {showCost && <td>{p.cost_price ? formatMoney(toMinor(p.cost_price), currency) : "—"}</td>}
                <td className={p.stock < 0 ? "danger-text" : undefined}>
                  {p.stock}
                  {p.stock <= 0 ? (
                    <span className="pill pill-offline">Out</span>
                  ) : low ? (
                    <span className="pill pill-pending">Low</span>
                  ) : null}
                </td>
                <td className={expiry?.status === "expired" ? "danger-text" : undefined}>
                  {expiry ? expiry.label : <span className="muted">—</span>}
                </td>
                {canEdit && (
                  <td className="row-actions">
                    {/* The ledger answers "why does it say 12 when there are 9
                        on the shelf", which is otherwise unanswerable here. */}
                    <button type="button" className="link" onClick={() => setInspecting(p)}>History</button>
                    <button type="button" className="link" onClick={() => setEditing(p)}>Edit</button>
                    <button type="button" className="link" onClick={() => setAdjusting(p)}>Adjust</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {visible.length === 0 && (
        <p className="muted">
          {rows.length === 0
            ? "Nothing to show. Sync to download the catalogue."
            : query
              ? `Nothing matches "${query.trim()}".`
              : "Nothing in this filter."}
        </p>
      )}

      {inspecting && storeId && (
        <ProductDetail product={inspecting} storeId={storeId} onClose={() => setInspecting(null)} />
      )}

      {editing && storeId && (
        <ProductForm
          storeId={storeId}
          currency={currency}
          product={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={afterWrite}
        />
      )}

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
