import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";

import { db, type LocalOrder } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { VoidDialog } from "./VoidDialog";

/**
 * Recent sales from this till.
 *
 * Deliberately local-only: a cashier needs to reprint the receipt they just
 * issued whether or not the shop has a connection. Orders still queued show as
 * such, so nobody assumes a sale has reached the books when it has not.
 */
export function OrdersPage() {
  const storeId = useSession((s) => s.storeId);
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const can = useSession((s) => s.can);

  // Voiding reverses stock and a customer's balance across the whole store, so
  // it is a manager's decision, matching the server's own policy.
  const mayVoid = can(["admin", "manager"]);
  const [voiding, setVoiding] = useState<LocalOrder | null>(null);

  const orders = useLiveQuery(
    async () => {
      if (!storeId) return [];
      const rows = await db.orders.where("store_id").equals(storeId).toArray();
      return rows.sort((a, b) => b.client_created_at.localeCompare(a.client_created_at)).slice(0, 200);
    },
    [storeId],
    [] as LocalOrder[],
  );

  return (
    <div className="page">
      <header className="page-header">
        <h1>Orders</h1>
        <p className="muted">Sales made on this till</p>
      </header>

      <table className="table">
        <thead>
          <tr><th>Receipt</th><th>When</th><th>Customer</th><th>Items</th><th>Total</th><th>Paid</th><th /><th /></tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const owed = toMinor(o.total) - toMinor(o.amount_paid);
            return (
              <tr key={o.id}>
                <td className="mono">{o.order_number}</td>
                <td>{new Date(o.client_created_at).toLocaleString()}</td>
                <td>{o.customer_name ?? <span className="muted">Walk-in</span>}</td>
                <td>{o.items.length}</td>
                <td>{formatMoney(toMinor(o.total), currency)}</td>
                <td className={owed > 0 ? "danger-text" : undefined}>
                  {formatMoney(toMinor(o.amount_paid), currency)}
                  {owed > 0 && <span className="muted"> ({formatMoney(owed, currency)} owed)</span>}
                </td>
                <td>
                  {/* A cashier reprinting a receipt must be able to tell whether
                      that sale actually reached the books. */}
                  {o._state === "pending" && <span className="pill pill-pending">Queued</span>}
                  {o._state === "clean" && <span className="pill pill-online">Synced</span>}
                  {o._state === "conflict" && <span className="pill pill-offline">Needs a decision</span>}
                  {o._state === "discarded" && <span className="pill pill-discarded">Discarded</span>}
                  {o.status === "voided" && <span className="pill pill-discarded">Voided</span>}
                </td>
                <td className="row-actions">
                  <Link to={`/receipt/${o.id}`}>Receipt</Link>
                  {mayVoid && o.status !== "voided" && o._state !== "discarded" && (
                    <button type="button" className="link danger" onClick={() => setVoiding(o)}>Void</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {orders.length === 0 && <p className="muted">No sales yet on this till.</p>}

      {voiding && (
        <VoidDialog
          order={voiding}
          currency={currency}
          onClose={() => setVoiding(null)}
          onVoided={() => {
            setVoiding(null);
            if (storeId) void useSync.getState().sync(storeId);
          }}
        />
      )}
    </div>
  );
}
