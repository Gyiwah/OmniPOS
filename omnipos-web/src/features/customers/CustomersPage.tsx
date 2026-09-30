import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Users,
  Plus,
  Search,
  X,
  Printer,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Edit2,
  Coins,
  CreditCard,
  UserCheck,
  TrendingUp,
} from "lucide-react";

import { db, type LocalCustomer } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { printTableAsPdf } from "@/utils/printTable";
import { CustomerForm } from "./CustomerForm";
import { PaymentForm } from "./PaymentForm";
import { StatementDialog } from "./StatementDialog";

import "./customers.css";

type FilterTab = "all" | "debt" | "settled" | "vip";

export function CustomersPage() {
  const storeId = useSession((s) => s.storeId);
  const store = useSession((s) => s.store);
  const currency = store?.currency ?? "GHS";

  const [query, setQuery] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [editing, setEditing] = useState<LocalCustomer | "new" | null>(null);
  const [settling, setSettling] = useState<LocalCustomer | null>(null);
  const [statement, setStatement] = useState<LocalCustomer | null>(null);

  const rawCustomers = useLiveQuery(
    async () => {
      if (!storeId) return [];
      const rows = await db.customers.where("store_id").equals(storeId).toArray();
      return rows.sort((a, b) => a.name.localeCompare(b.name));
    },
    [storeId],
    [] as LocalCustomer[],
  );

  // Compute metrics across all customers before search filtering
  const metrics = useMemo(() => {
    let totalDebt = 0;
    let totalSpend = 0;
    let owingCount = 0;
    let settledCount = 0;

    for (const c of rawCustomers) {
      const debt = toMinor(c.outstanding_balance);
      const spend = toMinor(c.total_spend);
      totalDebt += debt;
      totalSpend += spend;
      if (debt > 0) {
        owingCount++;
      } else {
        settledCount++;
      }
    }

    return {
      totalRegistered: rawCustomers.length,
      totalDebt,
      totalSpend,
      owingCount,
      settledCount,
    };
  }, [rawCustomers]);

  // Filtered customer list
  const filteredCustomers = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return rawCustomers
      .filter((c) => {
        if (needle && !c.search_key.includes(needle)) {
          return false;
        }

        const debt = Number(c.outstanding_balance);
        if (filterTab === "debt" && debt <= 0) return false;
        if (filterTab === "settled" && debt > 0) return false;
        if (filterTab === "vip" && toMinor(c.total_spend) <= 50000) return false; // VIP threshold

        return true;
      })
      .sort((a, b) => {
        if (filterTab === "debt") {
          return Number(b.outstanding_balance) - Number(a.outstanding_balance);
        }
        if (filterTab === "vip") {
          return Number(b.total_spend) - Number(a.total_spend);
        }
        return a.name.localeCompare(b.name);
      });
  }, [rawCustomers, query, filterTab]);

  return (
    <div className="customers-root">
      {/* --- Topbar Header --- */}
      <header className="customers-topbar">
        <div className="customers-title-block">
          <h1 className="customers-main-title">
            <Users size={26} aria-hidden="true" />
            <span>Customers & Accounts</span>
          </h1>
          <div className="customers-subtitle-row">
            <span>{store?.name ?? "OmniPOS Store"}</span>
            <span>·</span>
            <span>Customer ledger, store credit & account receivables</span>
            <span>·</span>
            <span className="dashboard-currency-tag" title="Store operating currency">
              Currency: <strong>{currency}</strong>
            </span>
          </div>
        </div>

        <div className="customers-header-actions">
          <button
            type="button"
            className="customers-export-btn"
            onClick={() =>
              printTableAsPdf({
                title: "Customer Accounts & Balances Ledger",
                columns: ["Client Name", "Phone", "Email", "Total Spend", "Outstanding Debt", "Status"],
                rows: filteredCustomers.map((c) => {
                  const hasDebt = Number(c.outstanding_balance) > 0;
                  return [
                    c.name,
                    c.phone ?? "—",
                    c.email ?? "—",
                    formatMoney(toMinor(c.total_spend), currency),
                    formatMoney(toMinor(c.outstanding_balance), currency),
                    hasDebt ? "Owing Credit" : "Settled",
                  ];
                }),
              })
            }
          >
            <Printer size={15} aria-hidden="true" />
            <span>Export PDF</span>
          </button>

          <button
            type="button"
            className="customers-add-btn"
            onClick={() => setEditing("new")}
          >
            <Plus size={16} aria-hidden="true" />
            <span>Add Customer</span>
          </button>
        </div>
      </header>

      {/* --- Executive KPI Bento Grid (4 Cards) --- */}
      <section className="customers-kpi-bento" aria-label="Customer Analytics Summary">
        <div className="customers-kpi-card">
          <div className="customers-kpi-top">
            <span className="customers-kpi-label">Registered Clients</span>
            <div className="customers-kpi-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              <UserCheck size={18} />
            </div>
          </div>
          <div className="customers-kpi-val">{metrics.totalRegistered}</div>
          <span className="customers-kpi-hint">Active customer profiles</span>
        </div>

        <div className="customers-kpi-card">
          <div className="customers-kpi-top">
            <span className="customers-kpi-label">Total Store Debt</span>
            <div className="customers-kpi-icon" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
              <AlertTriangle size={18} />
            </div>
          </div>
          <div className="customers-kpi-val" style={{ color: metrics.totalDebt > 0 ? "var(--danger)" : "var(--text-strong)" }}>
            {formatMoney(metrics.totalDebt, currency)}
          </div>
          <span className="customers-kpi-hint">Receivables pending settlement</span>
        </div>

        <div className="customers-kpi-card">
          <div className="customers-kpi-top">
            <span className="customers-kpi-label">Lifetime Client Sales</span>
            <div className="customers-kpi-icon" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}>
              <TrendingUp size={18} />
            </div>
          </div>
          <div className="customers-kpi-val">{formatMoney(metrics.totalSpend, currency)}</div>
          <span className="customers-kpi-hint">Cumulative registered trade</span>
        </div>

        <div className="customers-kpi-card">
          <div className="customers-kpi-top">
            <span className="customers-kpi-label">Accounts in Arrears</span>
            <div className="customers-kpi-icon" style={{ background: "var(--cta-soft)", color: "var(--cta)" }}>
              <CreditCard size={18} />
            </div>
          </div>
          <div className="customers-kpi-val">
            {metrics.owingCount} <span style={{ fontSize: "1rem", fontWeight: 600, color: "var(--muted)" }}>Owing</span> / {metrics.settledCount} <span style={{ fontSize: "1rem", fontWeight: 600, color: "var(--muted)" }}>Settled</span>
          </div>
          <span className="customers-kpi-hint">Store credit portfolio status</span>
        </div>
      </section>

      {/* --- Filter & Search Toolbar --- */}
      <section className="customers-toolbar-card">
        <div className="customers-search-wrap">
          <Search size={16} />
          <input
            className="customers-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer by name, phone or email..."
            aria-label="Search customers"
          />
          {query && (
            <button
              type="button"
              className="customers-clear-btn"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="customers-filter-chips" role="tablist" aria-label="Customer Status Filter">
          <button
            type="button"
            className={`customers-filter-chip ${filterTab === "all" ? "active" : ""}`}
            onClick={() => setFilterTab("all")}
          >
            <span>All Clients</span>
            <span className="customers-chip-badge">{rawCustomers.length}</span>
          </button>

          <button
            type="button"
            className={`customers-filter-chip ${filterTab === "debt" ? "active-danger" : ""}`}
            onClick={() => setFilterTab("debt")}
          >
            <span>Owing Debt</span>
            {metrics.owingCount > 0 && (
              <span className="customers-chip-badge">{metrics.owingCount}</span>
            )}
          </button>

          <button
            type="button"
            className={`customers-filter-chip ${filterTab === "settled" ? "active" : ""}`}
            onClick={() => setFilterTab("settled")}
          >
            <span>Settled Accounts</span>
          </button>

          <button
            type="button"
            className={`customers-filter-chip ${filterTab === "vip" ? "active" : ""}`}
            onClick={() => setFilterTab("vip")}
          >
            <span>Top Spenders</span>
          </button>
        </div>
      </section>

      {/* --- Customers Table Card --- */}
      <section className="customers-table-card">
        <div className="customers-table-wrap">
          <table className="customers-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th style={{ textAlign: "right" }}>Lifetime Spend</th>
                <th style={{ textAlign: "right" }}>Outstanding Debt</th>
                <th style={{ textAlign: "center" }}>Account Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((c) => {
                const hasDebt = Number(c.outstanding_balance) > 0;
                const initials = c.name
                  .split(" ")
                  .map((w) => w[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase() || "CU";

                return (
                  <tr
                    key={c.id}
                    className={hasDebt ? "customers-row-debt" : undefined}
                  >
                    <td>
                      <div className="customers-user-cell">
                        <div className={`customers-avatar ${hasDebt ? "debt" : ""}`}>
                          {initials}
                        </div>
                        <div className="customers-name-stack">
                          <span className="customers-name-title">{c.name}</span>
                          {c.email ? (
                            <span className="customers-email-sub">{c.email}</span>
                          ) : (
                            <span className="customers-email-sub" style={{ opacity: 0.6 }}>No email registered</span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td>
                      {c.phone ? (
                        <span className="mono" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                          {c.phone}
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: "0.82rem" }}>—</span>
                      )}
                    </td>

                    <td style={{ textAlign: "right", fontWeight: 700 }}>
                      {formatMoney(toMinor(c.total_spend), currency)}
                    </td>

                    <td style={{ textAlign: "right" }}>
                      <span
                        style={{
                          fontWeight: hasDebt ? 800 : 500,
                          color: hasDebt ? "var(--danger)" : "var(--muted)",
                          fontSize: "0.92rem",
                        }}
                      >
                        {formatMoney(toMinor(c.outstanding_balance), currency)}
                      </span>
                    </td>

                    <td style={{ textAlign: "center" }}>
                      {hasDebt ? (
                        <span className="customers-status-pill arrears">
                          <AlertTriangle size={13} />
                          <span>Debt Due</span>
                        </span>
                      ) : (
                        <span className="customers-status-pill settled">
                          <CheckCircle2 size={13} />
                          <span>Settled</span>
                        </span>
                      )}
                      {c._state === "pending" && (
                        <span className="customers-status-pill queued" style={{ marginLeft: "4px" }}>
                          Queued
                        </span>
                      )}
                    </td>

                    <td>
                      <div className="customers-action-group">
                        {hasDebt && (
                          <button
                            type="button"
                            className="customers-settle-btn"
                            onClick={() => setSettling(c)}
                            title="Take payment against debt"
                          >
                            <Coins size={14} aria-hidden="true" />
                            <span>Settle Debt</span>
                          </button>
                        )}

                        <button
                          type="button"
                          className="customers-action-btn"
                          onClick={() => setStatement(c)}
                          title="View customer transaction statement"
                        >
                          <FileText size={14} aria-hidden="true" />
                          <span>Statement</span>
                        </button>

                        <button
                          type="button"
                          className="customers-action-btn"
                          onClick={() => setEditing(c)}
                          title="Edit customer details"
                        >
                          <Edit2 size={14} aria-hidden="true" />
                          <span>Edit</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredCustomers.length === 0 && (
          <div className="customers-empty-state">
            <div className="customers-empty-icon">
              <Users size={28} />
            </div>
            <strong>No customers found</strong>
            <p style={{ margin: 0, fontSize: "0.85rem", maxWidth: "24rem" }}>
              {query
                ? `No customers match "${query}". Try adjusting your search query or filter.`
                : filterTab === "debt"
                  ? "Great news! No customers currently owe any outstanding store debt."
                  : "No customers are registered in this store yet. Click 'Add Customer' above to create the first profile."}
            </p>
          </div>
        )}
      </section>

      {/* --- Modals --- */}
      {statement && (
        <StatementDialog
          customer={statement}
          onClose={() => setStatement(null)}
        />
      )}

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
