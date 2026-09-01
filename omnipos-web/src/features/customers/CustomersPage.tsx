import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type LocalCustomer } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { CustomerForm } from "./CustomerForm";

export function CustomersPage() {
  const storeId = useSession((s) => s.storeId);
  const currency = useSession((s) => s.store?.currency) ?? "GHS";

  const [query, setQuery] = useState("");
  const [debtOnly, setDebtOnly] = useState(false);
  const [editing, setEditing] = useState<LocalCustomer | "new" | null>(null);

  const customers = useLiveQuery(
    async () => {
      if (!storeId) return [];
      const needle = query.trim().toLowerCase();
      let rows = await db.customers.where("store_id").equals(storeId).toArray();
      if (needle) rows = rows.filter((c) => c.search_key.includes(needle));
      if (debtOnly) rows = rows.filter((c) => Number(c.outstanding_balance) > 0);
      return rows.sort((a, b) => a.name.localeCompare(b.name));
    },
    [storeId, query, debtOnly],
    [] as LocalCustomer[],
  );

  const totalDebt = customers.reduce((sum, c) => sum + toMinor(c.outstanding_balance), 0);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Customers</h1>
        <div className="page-actions">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or phone"
            aria-label="Search customers"
          />
          <label className="checkbox">
            <input type="checkbox" checked={debtOnly} onChange={(e) => setDebtOnly(e.target.checked)} />
            Owing only
          </label>
          {/* Cashiers register customers at the counter, as the server allows. */}
          <button type="button" className="pay-button" onClick={() => setEditing("new")}>Add customer</button>
        </div>
      </header>

      {debtOnly && (
        <p className="muted">Total outstanding: <strong>{formatMoney(totalDebt, currency)}</strong></p>
      )}

      <table className="table">
        <thead>
          <tr><th>Name</th><th>Phone</th><th>Total spend</th><th>Outstanding</th><th /><th /></tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td className="mono">{c.phone ?? "—"}</td>
              <td>{formatMoney(toMinor(c.total_spend), currency)}</td>
              <td className={Number(c.outstanding_balance) > 0 ? "danger-text" : undefined}>
                {formatMoney(toMinor(c.outstanding_balance), currency)}
              </td>
              <td>{c._state === "pending" && <span className="pill pill-pending">Queued</span>}</td>
              <td className="row-actions">
                <button type="button" className="link" onClick={() => setEditing(c)}>Edit</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {customers.length === 0 && <p className="muted">No customers match.</p>}

      {editing && storeId && (
        <CustomerForm
          storeId={storeId}
          customer={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void useSync.getState().sync(storeId);
          }}
        />
      )}
    </div>
  );
}
