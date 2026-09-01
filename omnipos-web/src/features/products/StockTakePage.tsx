import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { api, ApiError } from "@/api/client";
import { db, type LocalProduct } from "@/db/schema";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";

type Adjustment = {
  product_id: string;
  name: string;
  was: number;
  counted: number;
  delta: number;
};

/**
 * Counting the shelves.
 *
 * Server-side and online-only, unlike almost everything else here. A stock take
 * is a claim about what the whole store holds right now, and the server is the
 * only party that knows what the other tills have sold since this device last
 * synced. A count queued offline and applied an hour later would silently erase
 * every sale made in between.
 *
 * What gets sent is the counted total; the server works out the difference and
 * posts a movement for it. Sending the difference from here would use this
 * device's possibly stale idea of what was there.
 */
export function StockTakePage() {
  const storeId = useSession((s) => s.storeId);
  const can = useSession((s) => s.can);
  const online = useSync((s) => s.online);

  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reference, setReference] = useState("");
  const [result, setResult] = useState<Adjustment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mayCount = can(["admin", "manager"]);

  const products = useLiveQuery(
    async () => {
      if (!storeId) return [];
      const needle = query.trim().toLowerCase();
      const rows = await db.products.where("store_id").equals(storeId).toArray();
      return rows
        .filter((p) => p.is_active && (!needle || p.search_key.includes(needle) || p.barcode === needle))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    [storeId, query],
    [] as LocalProduct[],
  );

  // Only lines actually counted are sent. A blank box means "not counted", which
  // is a different thing from zero — sending every product as zero would write
  // the entire catalogue off.
  const entered = useMemo(
    () =>
      Object.entries(counts)
        .filter(([, value]) => value.trim() !== "" && Number.isFinite(Number(value)))
        .map(([productId, value]) => ({ productId, counted: Number(value) })),
    [counts],
  );

  const differences = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    return entered.filter((e) => {
      const product = byId.get(e.productId);
      return product !== undefined && product.stock !== e.counted;
    });
  }, [entered, products]);

  const submit = async () => {
    if (!storeId || entered.length === 0) return;

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const res = await api.post<{ reference: string; adjustments: Adjustment[] }>("/api/inventory/stock-take", {
        reference: reference.trim() || undefined,
        counts: entered.map((e) => ({ product_id: e.productId, counted: e.counted })),
      });

      setResult(res.adjustments);
      setCounts({});

      // Pull the server's corrected figures straight back rather than guessing
      // at them locally.
      await useSync.getState().sync(storeId);
    } catch (e) {
      setError(
        e instanceof ApiError && e.isUnreachable
          ? "A stock take needs a connection — the server has to reconcile your count against every other till."
          : e instanceof Error
            ? e.message
            : "Could not record the count.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!mayCount) {
    return (
      <div className="page">
        <h1>Stock take</h1>
        <p className="notice notice-warn">Only an admin or manager can run a stock take.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Stock take</h1>
        <div className="page-actions">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, SKU or barcode"
            aria-label="Search products to count"
            autoFocus
          />
        </div>
      </header>

      <p className="conflict-hint">
        Type what is physically on the shelf. Leave a box empty for anything you did not count — empty is not the
        same as zero. The server works out each difference and records it as a movement, so nothing is overwritten.
      </p>

      {!online && (
        <p className="notice notice-warn">
          Offline. A count can only be reconciled by the server, which is the only party that knows what the other
          tills have sold. Selling still works.
        </p>
      )}

      {error && <p className="notice notice-error" role="status">{error}</p>}

      {result && (
        <div className="notice notice-ok" role="status">
          {result.length === 0 ? (
            "Everything you counted matched the books."
          ) : (
            <>
              Adjusted {result.length} {result.length === 1 ? "product" : "products"}:{" "}
              {result.map((a) => `${a.name} ${a.delta > 0 ? "+" : ""}${a.delta}`).join(", ")}
            </>
          )}
        </div>
      )}

      <table className="table">
        <thead>
          <tr><th>Product</th><th>SKU</th><th>Books say</th><th>Counted</th><th>Difference</th></tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const value = counts[p.id] ?? "";
            const counted = value.trim() === "" ? null : Number(value);
            const delta = counted === null || !Number.isFinite(counted) ? null : counted - p.stock;

            return (
              <tr key={p.id} className={delta !== null && delta !== 0 ? "row-warn" : undefined}>
                <td>{p.name}</td>
                <td className="mono">{p.sku}</td>
                <td>{p.stock}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    className="qty-input"
                    value={value}
                    aria-label={`Counted quantity of ${p.name}`}
                    onChange={(e) => setCounts({ ...counts, [p.id]: e.target.value })}
                  />
                </td>
                <td className={delta !== null && delta < 0 ? "danger-text" : undefined}>
                  {delta === null ? "—" : delta === 0 ? "matches" : `${delta > 0 ? "+" : ""}${delta}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <section className="drawer-card">
        <label htmlFor="st-ref">Reference</label>
        <input
          id="st-ref"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Monthly count, after the delivery…"
        />

        <p className="muted">
          {entered.length === 0
            ? "Nothing counted yet."
            : `${entered.length} counted, ${differences.length} ${differences.length === 1 ? "difference" : "differences"}.`}
        </p>

        <button type="button" className="pay-button" disabled={busy || entered.length === 0} onClick={() => void submit()}>
          {busy ? "Recording…" : "Record the count"}
        </button>
      </section>
    </div>
  );
}
