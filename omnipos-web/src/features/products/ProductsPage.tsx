import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, ClipboardList, Download, MoreHorizontal, Package, Plus, Search, Trash2, Upload, X } from "lucide-react";

import { db, type LocalBatch, type LocalCategory, type LocalProduct } from "@/db/schema";
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
import { ImportModal } from "./ImportModal";
import { ProductDetail } from "./ProductDetail";
import { ProductForm } from "./ProductForm";
import { StockAdjustForm } from "./StockAdjustForm";
import { deleteProduct, deleteProducts } from "./service";

const FILTERS: Array<{ key: StockFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "in_stock", label: "In stock" },
  { key: "low", label: "Low" },
  { key: "expiring_soon", label: "Expiring" },
  { key: "expired", label: "Expired" },
  { key: "out", label: "Out" },
];

function productImageUrl(imageRef: string): string {
  if (/^https?:\/\//i.test(imageRef) || imageRef.startsWith("/api/media/")) return imageRef;
  return `/api/media/${imageRef.replace(/^\/+/, "")}`;
}

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
  const [categoryFilter, setCategoryFilter] = useState("");
  const [editing, setEditing] = useState<LocalProduct | "new" | null>(null);
  const [adjusting, setAdjusting] = useState<LocalProduct | null>(null);
  const [inspecting, setInspecting] = useState<LocalProduct | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const afterWrite = () => {
    setEditing(null);
    setAdjusting(null);
    if (storeId) void useSync.getState().sync(storeId);
  };

  const removeProduct = async (product: LocalProduct) => {
    if (!storeId || !window.confirm(`Delete "${product.name}"? It will no longer be available for sale.`)) return;

    await deleteProduct(storeId, product.id);
    setEditing(null);
    setAdjusting(null);
    setInspecting(null);
    void useSync.getState().sync(storeId);
  };

  const removeSelected = async () => {
    if (!storeId || selectedIds.size === 0) return;
    const selected = rows.filter(({ product }) => selectedIds.has(product.id)).map(({ product }) => product);
    if (!window.confirm(`Delete ${selected.length} selected ${selected.length === 1 ? "product" : "products"}?`)) return;

    await deleteProducts(storeId, selected.map((product) => product.id));
    setSelectedIds(new Set());
    void useSync.getState().sync(storeId);
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

  const categories = useLiveQuery(
    () => storeId ? db.categories.where("store_id").equals(storeId).sortBy("position") : Promise.resolve([] as LocalCategory[]),
    [storeId],
  );
  const categoryNames = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category.name])),
    [categories],
  );

  const counts = useMemo(() => countByFilter(rows), [rows]);
  const visible = useMemo(
    () => rows.filter((r) => (
      matchesFilter(r, filter)
      && matchesQuery(r, query)
      && (!categoryFilter || r.product.category_id === categoryFilter)
    )),
    [rows, filter, query, categoryFilter],
  );
  const allVisibleSelected = visible.length > 0 && visible.every(({ product }) => selectedIds.has(product.id));

  const toggleSelected = (productId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visible.forEach(({ product }) => next.delete(product.id));
      else visible.forEach(({ product }) => next.add(product.id));
      return next;
    });
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1><Package size={20} aria-hidden="true" /> Inventory</h1>
        <div className="page-actions">
          <div className="search-field">
            <Search size={17} aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products"
              aria-label="Search products by name, SKU, barcode or tag"
            />
            {query && (
              <button type="button" className="search-clear" onClick={() => setQuery("")} aria-label="Clear product search">
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter products by category"
          >
            <option value="">All categories</option>
            {(categories ?? []).map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
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
              <button type="button" className="secondary-button" onClick={() => setImporting(true)}>
                <Upload size={16} aria-hidden="true" />
                Import
              </button>
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

      {!canEdit && (
        <p className="muted">
          Catalogue changes need a manager or admin. Cashiers can still sell and adjust stock.
        </p>
      )}

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

      {query.trim() && (
        <p className="search-results muted">
          Showing {visible.length} of {rows.length} products
        </p>
      )}

      {canEdit && selectedIds.size > 0 && (
        <div className="bulk-actions" role="toolbar" aria-label="Selected product actions">
          <strong>{selectedIds.size} selected</strong>
          <button type="button" className="secondary-button danger-button" onClick={() => void removeSelected()}>
            <Trash2 size={16} aria-hidden="true" />
            Delete selected
          </button>
          <button type="button" className="link" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
        </div>
      )}

      {/* Wide tables scroll inside their own box. Without this the whole
          page scrolls sideways on a tablet, and the filter chips and header
          slide off with it. */}
      <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th className="selection-cell">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                aria-label="Select all visible products"
              />
            </th>
            <th>Name</th><th>Category</th><th>SKU</th><th>Price</th>
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
                <td className="selection-cell">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.id)}
                    onChange={() => toggleSelected(p.id)}
                    aria-label={`Select ${p.name}`}
                  />
                </td>
                <td>
                  {p.image_url ? (
                    <img src={productImageUrl(p.image_url)} alt="" className="product-thumb" loading="lazy" />
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
                <td>{p.category_id ? categoryNames.get(p.category_id) ?? <span className="muted">Unknown</span> : <span className="muted">Uncategorised</span>}</td>
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
                    <details className="action-menu">
                      <summary aria-label={`Actions for ${p.name}`}>
                        <MoreHorizontal size={18} aria-hidden="true" />
                        <span>Actions</span>
                      </summary>
                      <div className="action-menu-list">
                        <button type="button" onClick={(event) => {
                          event.currentTarget.closest("details")?.removeAttribute("open");
                          setInspecting(p);
                        }}>History</button>
                        <button type="button" onClick={(event) => {
                          event.currentTarget.closest("details")?.removeAttribute("open");
                          setEditing(p);
                        }}>Edit</button>
                        <button type="button" onClick={(event) => {
                          event.currentTarget.closest("details")?.removeAttribute("open");
                          setAdjusting(p);
                        }}>Adjust</button>
                        <button type="button" className="danger" onClick={(event) => {
                          event.currentTarget.closest("details")?.removeAttribute("open");
                          void removeProduct(p);
                        }}>
                          <Trash2 size={14} aria-hidden="true" />
                          Delete
                        </button>
                      </div>
                    </details>
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

      {importing && storeId && (
        <ImportModal
          storeId={storeId}
          currency={currency}
          onClose={() => setImporting(false)}
          onImported={() => {
            if (storeId) void useSync.getState().sync(storeId);
          }}
        />
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
