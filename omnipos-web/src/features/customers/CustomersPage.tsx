import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type LocalCustomer } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";

export function CustomersPage() {
  const storeId = useSession((s) => s.storeId);
  const currency = useSession((s) => s.store?.currency) ?? "GHS";

  const [query, setQuery] = useState("");
  const [debtOnly, setDebtOnly] = useState(false);

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
        </div>
      </header>

      {debtOnly && (
        <p className="muted">Total outstanding: <strong>{formatMoney(totalDebt, currency)}</strong></p>
      )}

      <table className="table">
        <thead>
          <tr><th>Name</th><th>Phone</th><th>Total spend</th><th>Outstanding</th></tr>
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
            </tr>
          ))}
        </tbody>
      </table>

      {customers.length === 0 && <p className="muted">No customers match.</p>}
    </div>
  );
}
