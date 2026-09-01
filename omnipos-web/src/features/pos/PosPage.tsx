import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, CreditCard, Search } from "lucide-react";

import { db, type LocalCategory, type LocalProduct } from "@/db/schema";
import { uuidv7 } from "@/core/uuidv7";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import {
  addLine,
  balanceDue,
  canComplete,
  changeDue,
  computeTotals,
  formatMoney,
  lineTotal,
  oversoldLines,
  removeLine,
  setQuantity,
  toDecimal,
  toMinor,
  type CartLine,
  type DiscountMode,
  type TenderLine,
} from "./cart";
import { useCurrentShift } from "@/features/shifts/useCurrentShift";
import { completeSale, nextOrderNumber } from "./checkout";
import { PaymentPanel } from "./PaymentPanel";

const TENDER_METHODS = ["cash", "card", "transfer", "mobile_money"] as const;

/**
 * The till.
 *
 * Everything renders from IndexedDB, so the screen is fully usable with no
 * network. Search is over the local catalogue; checkout writes locally and
 * queues an operation. Nothing here awaits a request.
 *
 * The search field holds focus by default because a barcode scanner is a
 * keyboard: it types the code and presses Enter. If focus is anywhere else the
 * scan is lost, so it is deliberately reclaimed after every interaction.
 */
export function PosPage() {
  const storeId = useSession((s) => s.storeId);
  const store = useSession((s) => s.store);
  const currency = store?.currency ?? "GHS";

  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [discountMode, setDiscountMode] = useState<DiscountMode>("percentage");
  const [discountValue, setDiscountValue] = useState(0);
  const [tenders, setTenders] = useState<TenderLine[]>([]);
  const [customer, setCustomer] = useState<{ id: string; name: string; phone: string | null } | null>(null);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Kept so the cashier can print the receipt for the sale they just rang up. */
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);

  const shift = useCurrentShift();
  const navigate = useNavigate();

  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useCallback(() => searchRef.current?.focus(), []);

  const categories = useLiveQuery(
    () =>
      storeId
        ? db.categories.where("store_id").equals(storeId).sortBy("position")
        : Promise.resolve([] as LocalCategory[]),
    [storeId],
    [] as LocalCategory[],
  );

  const products = useLiveQuery(
    async () => {
      if (!storeId) return [];
      const needle = query.trim().toLowerCase();

      let collection = db.products.where("store_id").equals(storeId);
      let rows = await collection.toArray();

      rows = rows.filter((p) => p.is_active);
      if (categoryId) rows = rows.filter((p) => p.category_id === categoryId);
      if (needle) {
        rows = rows.filter((p) => p.search_key.includes(needle) || p.barcode === needle);
      }

      return rows.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60);
    },
    [storeId, query, categoryId],
    [] as LocalProduct[],
  );

  const rates = useMemo(
    () => ({
      taxRate: Number(store?.tax_rate ?? 0),
      vatRate: Number(store?.vat_rate ?? 0),
      serviceRate: Number(store?.service_rate ?? 0),
    }),
    [store],
  );

  const totals = useMemo(
    () => computeTotals(lines, discountMode, discountValue, rates),
    [lines, discountMode, discountValue, rates],
  );

  const oversold = useMemo(() => oversoldLines(lines), [lines]);

  const addProduct = useCallback((product: LocalProduct) => {
    setLines((current) =>
      addLine(current, {
        id: uuidv7(),
        productId: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        unitPrice: toMinor(product.price),
        unitCost: product.cost_price === null ? null : toMinor(product.cost_price),
        availableStock: product.stock,
      }),
    );
    setNotice(null);
  }, []);

  /**
   * Enter either resolves an exact barcode or SKU — the scanner path — or falls
   * back to the single visible match, which is what a cashier typing a few
   * letters expects.
   */
  const onSearchSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const needle = query.trim().toLowerCase();
      if (!needle || !storeId) return;

      const exact = await db.products
        .where("store_id")
        .equals(storeId)
        .filter((p) => p.barcode === needle || p.sku.toLowerCase() === needle)
        .first();

      const chosen = exact ?? (products.length === 1 ? products[0] : null);

      if (chosen) {
        addProduct(chosen);
        setQuery("");
      } else if (products.length === 0) {
        setNotice({ kind: "warn", text: `Nothing matches "${query.trim()}".` });
      }

      focusSearch();
    },
    [query, storeId, products, addProduct, focusSearch],
  );

  // F2 pays, Escape clears. Both are reachable without leaving the keyboard,
  // which is the difference between a usable till and a slow one.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F2" && lines.length > 0) {
        event.preventDefault();
        setPaying(true);
      }
      if (event.key === "Escape") {
        if (paying) setPaying(false);
        else focusSearch();
      }
      if (event.key === "F4" && lastOrderId) {
        event.preventDefault();
        navigate(`/receipt/${lastOrderId}?print=1`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lines.length, paying, focusSearch, lastOrderId, navigate]);

  const reset = useCallback(() => {
    setLines([]);
    setTenders([]);
    setDiscountValue(0);
    setCustomer(null);
    setPaying(false);
    focusSearch();
  }, [focusSearch]);

  const onComplete = useCallback(async () => {
    if (!storeId || busy) return;

    const check = canComplete(totals.total, tenders, customer !== null);
    if (!check.ok) {
      setNotice({ kind: "error", text: check.reason });
      return;
    }

    setBusy(true);
    try {
      const orderNumber = await nextOrderNumber(storeId);
      const order = await completeSale({
        storeId,
        lines,
        discountMode,
        discountValue,
        rates,
        tenders,
        customer,
        // Null when no drawer is open. The sale still completes — see the
        // banner above the cart for why that is deliberate.
        registerShiftId: shift?.id ?? null,
        orderNumber,
      });

      setLastOrderId(order.id);

      const change = changeDue(totals.total, tenders);
      const owed = balanceDue(totals.total, tenders);

      setNotice({
        kind: "ok",
        text:
          `${order.order_number} completed.` +
          (change > 0 ? ` Change ${formatMoney(change, currency)}.` : "") +
          (owed > 0 ? ` ${formatMoney(owed, currency)} added to ${customer?.name}'s account.` : ""),
      });

      reset();

      // Opportunistic: the sale is already safe in the outbox, so a failure here
      // changes nothing.
      void useSync.getState().sync(storeId);
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not complete the sale.",
      });
    } finally {
      setBusy(false);
    }
  }, [storeId, busy, totals.total, tenders, customer, lines, discountMode, discountValue, rates, currency, reset, shift]);

  if (!storeId) {
    return <div className="pos-empty">Select a store to start selling.</div>;
  }

  return (
    <div className="pos">
      <section className="pos-catalogue">
        <form onSubmit={onSearchSubmit} className="pos-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={searchRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Scan barcode or search by name / SKU"
            aria-label="Scan barcode or search products"
            className="pos-search-input"
          />
        </form>

        <div className="pos-categories">
          <button
            type="button"
            className={categoryId === null ? "chip chip-active" : "chip"}
            onClick={() => { setCategoryId(null); focusSearch(); }}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={categoryId === c.id ? "chip chip-active" : "chip"}
              onClick={() => { setCategoryId(c.id); focusSearch(); }}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="pos-grid" role="list">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              role="listitem"
              className="product-tile"
              onClick={() => { addProduct(p); focusSearch(); }}
            >
              <span className="product-name">{p.name}</span>
              <span className="product-price">{formatMoney(toMinor(p.price), currency)}</span>
              <span className={p.stock <= 0 ? "product-stock product-stock-out" : "product-stock"}>
                {p.stock <= 0 ? "Out of stock" : `${p.stock} in stock`}
              </span>
            </button>
          ))}
          {products.length === 0 && (
            <p className="pos-grid-empty">
              {query ? "No matching products." : "No products yet. Sync or add some in Inventory."}
            </p>
          )}
        </div>
      </section>

      <section className="pos-cart" aria-label="Current sale">
        {/*
          A warning, not a block. Refusing to sell because nobody counted the
          float would stop the shop trading over a bookkeeping detail; an
          unattributed sale is recoverable, a queue of turned-away customers is
          not. The cost is stated plainly instead.
        */}
        {!shift && (
          <p className="warn">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>No drawer open. Sales will not be counted in any cash reconciliation.{" "}
            <Link to="/shift">Open one</Link>.</span>
          </p>
        )}

        <header className="cart-header">
          <h2>Current sale</h2>
          {customer ? (
            <button type="button" className="link" onClick={() => setCustomer(null)}>
              {customer.name} &times;
            </button>
          ) : (
            <span className="muted">Walk-in</span>
          )}
        </header>

        <ul className="cart-lines">
          {lines.map((line) => (
            <li key={line.id} className="cart-line">
              <div className="cart-line-main">
                <span className="cart-line-name">{line.name}</span>
                <span className="cart-line-total">{formatMoney(lineTotal(line), currency)}</span>
              </div>
              <div className="cart-line-controls">
                <button type="button" onClick={() => setLines((l) => setQuantity(l, line.id, line.quantity - 1))}>
                  &minus;
                </button>
                <input
                  type="number"
                  min={0}
                  value={line.quantity}
                  aria-label={`Quantity for ${line.name}`}
                  onChange={(e) => setLines((l) => setQuantity(l, line.id, Number(e.target.value)))}
                />
                <button type="button" onClick={() => setLines((l) => setQuantity(l, line.id, line.quantity + 1))}>
                  +
                </button>
                {/*
                  Grouped so the row can be laid out with space-between rather
                  than an auto margin. An auto margin absorbs the free space in a
                  flex line, which stops it wrapping and pushes the last control
                  past the edge — that clipped "Remove", leaving no way to
                  correct a mis-scan.
                */}
                <span className="cart-line-right">
                  <span className="cart-line-unit">@ {formatMoney(line.unitPrice, currency)}</span>
                  <button type="button" className="link danger" onClick={() => setLines((l) => removeLine(l, line.id))}>
                    Remove
                  </button>
                </span>
              </div>
            </li>
          ))}
          {lines.length === 0 && <li className="cart-empty">Scan or tap a product to begin.</li>}
        </ul>

        {oversold.length > 0 && (
          <p className="warn" role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>
            Selling more than stock on hand: {oversold.map((l) => l.name).join(", ")}. The sale is allowed and will
            be flagged for reconciliation.</span>
          </p>
        )}

        <div className="cart-discount">
          <label htmlFor="discount">Discount</label>
          <input
            id="discount"
            type="number"
            min={0}
            value={discountMode === "percentage" ? discountValue : discountValue / 100}
            onChange={(e) =>
              setDiscountValue(
                discountMode === "percentage" ? Number(e.target.value) : toMinor(e.target.value),
              )
            }
          />
          <select
            value={discountMode}
            aria-label="Discount type"
            onChange={(e) => { setDiscountMode(e.target.value as DiscountMode); setDiscountValue(0); }}
          >
            <option value="percentage">%</option>
            <option value="amount">{currency}</option>
          </select>
        </div>

        <dl className="cart-totals">
          <div><dt>Subtotal</dt><dd>{formatMoney(totals.subtotal, currency)}</dd></div>
          {totals.discount > 0 && (
            <div><dt>Discount</dt><dd>&minus;{formatMoney(totals.discount, currency)}</dd></div>
          )}
          {totals.tax > 0 && <div><dt>Tax</dt><dd>{formatMoney(totals.tax, currency)}</dd></div>}
          <div className="cart-total"><dt>Total</dt><dd>{formatMoney(totals.total, currency)}</dd></div>
        </dl>

        {notice && (
          <p className={`notice notice-${notice.kind}`} role="status">
            {notice.text}
            {notice.kind === "ok" && lastOrderId && (
              <>
                {" "}
                <Link to={`/receipt/${lastOrderId}?print=1`}>Print receipt</Link>
              </>
            )}
          </p>
        )}

        <button
          type="button"
          className="pay-button"
          disabled={lines.length === 0 || busy}
          onClick={() => setPaying(true)}
        >
          {busy ? "Working…" : <><CreditCard size={18} aria-hidden="true" />{`Pay ${formatMoney(totals.total, currency)}`}</>}
          <kbd>F2</kbd>
        </button>
      </section>

      {paying && (
        <PaymentPanel
          total={totals.total}
          currency={currency}
          tenders={tenders}
          methods={[...TENDER_METHODS]}
          customer={customer}
          storeId={storeId}
          busy={busy}
          onTendersChange={setTenders}
          onCustomerChange={setCustomer}
          onCancel={() => setPaying(false)}
          onConfirm={onComplete}
        />
      )}
    </div>
  );
}

export { toDecimal };
