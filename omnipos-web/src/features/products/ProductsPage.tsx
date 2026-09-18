import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Download, MoreHorizontal, Package, Plus, ScanLine, Search, Trash2, Upload, X } from "lucide-react";

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
import { BarcodeScanner } from "../pos/BarcodeScanner";

const FILTERS: Array<{ key: StockFilter; label: string; color?: string }> = [
  { key: "all", label: "All Products" },
  { key: "in_stock", label: "In Stock", color: "#16a34a" },
  { key: "low", label: "Low Stock", color: "#d97706" },
  { key: "expiring_soon", label: "Expiring Soon (<30d)", color: "#d97706" },
  { key: "expired", label: "Expired", color: "#dc2626" },
  { key: "out", label: "Out of Stock", color: "#dc2626" },
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
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<StockFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [editing, setEditing] = useState<LocalProduct | "new" | null>(null);
  const [adjusting, setAdjusting] = useState<LocalProduct | null>(null);
  const [inspecting, setInspecting] = useState<LocalProduct | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const showToast = (kind: "ok" | "error", text: string) => setToast({ kind, text });

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const afterWrite = () => {
    setEditing(null);
    setAdjusting(null);
    showToast("ok", "Inventory updated successfully.");
    if (storeId) void useSync.getState().sync(storeId);
  };

  const removeProduct = async (product: LocalProduct) => {
    if (!storeId || !window.confirm(`Delete "${product.name}"? It will no longer be available for sale.`)) return;

    try {
      await deleteProduct(storeId, product.id);
      setEditing(null);
      setAdjusting(null);
      setInspecting(null);
      showToast("ok", `${product.name} was deleted.`);
      void useSync.getState().sync(storeId);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not delete the product.");
    }
  };

  const removeSelected = async () => {
    if (!storeId || selectedIds.size === 0) return;
    const selected = rows.filter(({ product }) => selectedIds.has(product.id)).map(({ product }) => product);
    if (!window.confirm(`Delete ${selected.length} selected ${selected.length === 1 ? "product" : "products"}?`)) return;

    try {
      await deleteProducts(storeId, selected.map((product) => product.id));
      setSelectedIds(new Set());
      showToast("ok", `${selected.length} product${selected.length === 1 ? "" : "s"} deleted.`);
      void useSync.getState().sync(storeId);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not delete the selected products.");
    }
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
  const counts = useMemo(() => countByFilter(rows), [rows]);
  const visible = useMemo(
    () => rows.filter((r) => (
      matchesFilter(r, filter)
      && matchesQuery(r, query)
      && (!categoryFilter || r.product.category_id === categoryFilter)
    )),
    [rows, filter, query, categoryFilter],
  );
  const selectedFilter = FILTERS.find((item) => item.key === filter) ?? FILTERS[0];

  const toggleSelected = (productId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  return (
    <div className="page">
      <header className="inventory-header">
        <div>
          <h1><Package size={20} aria-hidden="true" /> Inventory</h1>
          <p>Stock catalog, batch tracking &amp; exports</p>
        </div>
        <div className="inventory-header-actions">
          <button type="button" className="inventory-icon-button" disabled={rows.length === 0} onClick={() => exportInventoryCsv(rows, storeName, currency)} aria-label="Export or print inventory" title="Export inventory">
            <Download size={19} aria-hidden="true" />
          </button>
          {canEdit && <button type="button" className="inventory-icon-button inventory-add-button" onClick={() => setEditing("new")} aria-label="Add product" title="Add product"><Plus size={21} aria-hidden="true" /></button>}
        </div>
      </header>

      {toast && <p className={`inventory-toast inventory-toast-${toast.kind}`} role="status"><CheckCircle2 size={16} aria-hidden="true" />{toast.text}</p>}

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
        <div className="inventory-alert">
          <span className="inventory-alert-icon"><AlertTriangle size={19} aria-hidden="true" /></span>
          <span>
          <strong>Expiry Attention Needed</strong>
          <small>
          {counts.expired > 0 && `${counts.expired} ${counts.expired === 1 ? "product has" : "products have"} expired stock`}
          {counts.expired > 0 && counts.expiring_soon > 0 && " · "}
          {counts.expiring_soon > 0 && `${counts.expiring_soon} expiring within 30 days`}
          </small>
          </span>
          <button
            className="inventory-alert-action"
            type="button"
            onClick={() => setFilter(counts.expired > 0 ? "expired" : "expiring_soon")}
          >
            View
          </button>
        </div>
      )}

      <section className="inventory-section inventory-search-section">
        <label className="inventory-search-field">
          <span className="visually-hidden">Search products</span>
          <Search size={18} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by SKU, name, or barcode..." aria-label="Search products by name, SKU, barcode or tag" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear product search"><X size={18} aria-hidden="true" /></button>}
          <button type="button" onClick={() => setScanning(true)} aria-label="Scan product barcode"><ScanLine size={19} aria-hidden="true" /></button>
        </label>
        <div className="inventory-filter-label">Filter By Status</div>
        <button type="button" className={`inventory-filter-trigger ${filterOpen ? "is-open" : ""}`} onClick={() => setFilterOpen((open) => !open)} aria-expanded={filterOpen}>
          <span><span className="inventory-status-dot" style={{ backgroundColor: selectedFilter.color ?? "var(--accent)" }} />{selectedFilter.label}</span>
          <span><b>{counts[filter]}</b>{filterOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
        </button>
        {filterOpen && <div className="inventory-filter-menu">
          {FILTERS.map((item) => <button key={item.key} type="button" className={item.key === filter ? "selected" : ""} onClick={() => { setFilter(item.key); setFilterOpen(false); }}>
            <span><span className="inventory-status-dot" style={{ backgroundColor: item.color ?? "var(--accent)" }} />{item.label}</span><b>{counts[item.key]}</b>
          </button>)}
        </div>}
        <select className="inventory-category-filter" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter products by category">
          <option value="">All categories</option>
          {(categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </section>

      {scanning && <BarcodeScanner onScan={(value) => { setQuery(value); setScanning(false); }} onClose={() => setScanning(false)} />}

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
      <section className="inventory-section inventory-products-section">
        <div className="inventory-list-header">
          <h2>Products ({visible.length})</h2>
          <span>{selectedFilter.label}</span>
          {canEdit && <div className="inventory-list-actions">
            <button type="button" onClick={() => setImporting(true)} aria-label="Import products" title="Import products"><Upload size={16} /></button>
            <Link to="/stock-take" aria-label="Open stock take" title="Stock take"><ClipboardList size={16} /></Link>
          </div>}
        </div>
        <div className="inventory-list">
          {visible.map(({ product: p, expiry }) => {
            const low = p.stock > 0 && p.stock <= p.reorder_level;
            const expired = expiry?.status === "expired";
            return (
              <article key={p.id} className={`inventory-card ${expired ? "inventory-card-expired" : low ? "inventory-card-low" : ""}`}>
                <input className="inventory-card-check" type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelected(p.id)} aria-label={`Select ${p.name}`} />
                <button type="button" className="inventory-card-main" onClick={() => setEditing(p)}>
                  {p.image_url ? (
                    <img src={productImageUrl(p.image_url)} alt="" className="product-thumb" loading="lazy" />
                  ) : (
                    // Initial rather than a generic box: at a glance down a long
                    // list it still distinguishes one row from the next.
                    <span className="product-thumb product-thumb-empty" aria-hidden="true">
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="inventory-card-body"><strong>{p.name}</strong><small>SKU: {p.sku}</small><span className="inventory-badges">
                    <span className={`inventory-stock-pill ${p.stock <= 0 ? "out" : low ? "low" : "in"}`}>{p.stock <= 0 ? "Out of stock" : low ? `${p.stock} Low` : `${p.stock} In stock`}</span>
                    {expiry && <span className={`inventory-expiry-pill ${expired ? "expired" : "soon"}`}>{expiry.label}</span>}
                  </span></span>
                </button>
                <div className="inventory-card-price"><strong>{formatMoney(toMinor(p.price), currency)}</strong>{showCost && p.cost_price && <small>Cost: {formatMoney(toMinor(p.cost_price), currency)}</small>}</div>
                {canEdit && <details className="action-menu inventory-card-menu">
                      <summary aria-label={`Actions for ${p.name}`}><MoreHorizontal size={18} aria-hidden="true" /></summary>
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
                }
              </article>
            );
          })}
        </div>
      </section>

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
            showToast("ok", "Products imported successfully.");
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
          onStockOut={() => {
            if (editing !== "new") {
              setAdjusting(editing);
              setEditing(null);
            }
          }}
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
