import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Users } from "lucide-react";

import { db, type LocalCustomer } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { CustomerForm } from "./CustomerForm";
import { PaymentForm } from "./PaymentForm";
import { StatementDialog } from "./StatementDialog";

export function CustomersPage() {
  const storeId = useSession((s) => s.storeId);
  const currency = useSession((s) => s.store?.currency) ?? "GHS";

  const [query, setQuery] = useState("");
  const [debtOnly, setDebtOnly] = useState(false);
  const [editing, setEditing] = useState<LocalCustomer | "new" | null>(null);
  const [settling, setSettling] = useState<LocalCustomer | null>(null);
  const [statement, setStatement] = useState<LocalCustomer | null>(null);

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
        <h1><Users size={20} aria-hidden="true" /> Customers</h1>
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
          <button type="button" className="pay-button" onClick={() => setEditing("new")}>
            <Plus size={17} aria-hidden="true" />
            Add customer
          </button>
        </div>
      </header>

      {/* Summary Metrics Row */}
      <div className="grid-3" style={{ marginBottom: "1.25rem", gap: "1rem" }}>
        <div className="stat-card">
          <div className="muted" style={{ fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 600 }}>Total Registered</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "0.25rem" }}>{customers.length} clients</div>
        </div>
        <div className="stat-card">
          <div className="muted" style={{ fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 600 }}>Total Outstanding Debt</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "0.25rem", color: "var(--danger, #dc2626)" }}>
            {formatMoney(totalDebt, currency)}
          </div>
        </div>
        <div className="stat-card">
          <div className="muted" style={{ fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 600 }}>Total Client Spend</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "0.25rem", color: "var(--success, #16a34a)" }}>
            {formatMoney(customers.reduce((sum, c) => sum + toMinor(c.total_spend), 0), currency)}
          </div>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Total Spend</th>
            <th>Outstanding</th>
            <th>Status</th>
            <th style={{ textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => {
            const hasDebt = Number(c.outstanding_balance) > 0;
            return (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td className="mono">{c.phone ?? "—"}</td>
                <td>{formatMoney(toMinor(c.total_spend), currency)}</td>
                <td className={hasDebt ? "danger-text" : undefined} style={{ fontWeight: hasDebt ? 700 : 400 }}>
                  {formatMoney(toMinor(c.outstanding_balance), currency)}
                </td>
                <td>
                  {hasDebt ? (
                    <span className="pill pill-danger" style={{ background: "#fee2e2", color: "#dc2626", fontWeight: 600, padding: "2px 8px", borderRadius: "12px", fontSize: "0.75rem" }}>
                      Unpaid Debt
                    </span>
                  ) : (
                    <span className="pill pill-success" style={{ background: "#dcfce7", color: "#16a34a", fontWeight: 600, padding: "2px 8px", borderRadius: "12px", fontSize: "0.75rem" }}>
                      Settled
                    </span>
                  )}
                  {c._state === "pending" && (
                    <span className="pill pill-pending" style={{ marginLeft: "4px" }}>Queued</span>
                  )}
                </td>
                <td className="row-actions" style={{ textAlign: "right" }}>
                  <button type="button" className="link" onClick={() => setStatement(c)}>Statement</button>
                  {hasDebt && (
                    <button
                      type="button"
                      className="button button-sm primary"
                      style={{ padding: "4px 10px", fontSize: "0.8rem", marginLeft: "6px" }}
                      onClick={() => setSettling(c)}
                    >
                      Settle Debt
                    </button>
                  )}
                  <button type="button" className="link" style={{ marginLeft: "6px" }} onClick={() => setEditing(c)}>Edit</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {customers.length === 0 && <p className="muted">No customers match.</p>}

      {statement && <StatementDialog customer={statement} onClose={() => setStatement(null)} />}

      {settling && storeId && (
        <PaymentForm
          storeId={storeId}
          currency={currency}
          customer={settling}
          onClose={() => setSettling(null)}
          onSaved={() => {
            setSettling(null);
            void useSync.getState().sync(storeId);
          }}
        />
      )}

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
