import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  TrendingUp,
  Users,
  Coins,
  Boxes,
  Printer,
  DollarSign,
  AlertTriangle,
  ShoppingBag,
  Sparkles,
  Phone,
  PackageX,
  Clock,
} from "lucide-react";

import { api, ApiError } from "@/api/client";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { printTableAsPdf } from "@/utils/printTable";

import "./reports.css";

type Range = { from: string; to: string; label: string };

function rangeFor(days: number, label: string): Range {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label };
}

const RANGES = [rangeFor(7, "7 Days"), rangeFor(30, "30 Days"), rangeFor(90, "90 Days")];

const TABS = [
  { key: "profit", label: "Profit & Margins", icon: DollarSign, roles: ["admin", "manager"] },
  { key: "cashiers", label: "Cashier Audits", icon: Users, roles: ["admin", "manager"] },
  { key: "customers", label: "Customer Accounts", icon: Coins },
  { key: "inventory", label: "Inventory & Valuation", icon: Boxes },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function ReportsPage() {
  const can = useSession((s) => s.can);
  const store = useSession((s) => s.store);
  const [tab, setTab] = useState<TabKey>(can(["admin", "manager"]) ? "profit" : "customers");
  const [range, setRange] = useState(RANGES[1]);

  const visibleTabs = TABS.filter((t) => !("roles" in t) || can([...t.roles]));

  return (
    <div className="reports-root">
      {/* --- Topbar Header --- */}
      <header className="reports-topbar">
        <div className="reports-title-block">
          <h1 className="reports-main-title">
            <BarChart3 size={26} aria-hidden="true" />
            <span>Store Reports & Analytics</span>
          </h1>
          <div className="dashboard-clock-row">
            <span>{store?.name ?? "OmniPOS Store"}</span>
            <span>·</span>
            <span>Multi-terminal store reporting and performance analytics</span>
          </div>
        </div>

        <div className="reports-top-controls">
          {/* Timeframe Range Selector (relevant for profit & cashier reports) */}
          {(tab === "profit" || tab === "cashiers") && (
            <div className="reports-range-pill" role="tablist" aria-label="Reporting Range">
              {RANGES.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  role="tab"
                  aria-selected={r.label === range.label}
                  className={`reports-range-btn ${r.label === range.label ? "active" : ""}`}
                  onClick={() => setRange(r)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* --- Navigation Tab Bar --- */}
      <nav className="reports-nav-bar" role="tablist" aria-label="Report Subsections">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const isActive = t.key === tab;

          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`reports-nav-tab ${isActive ? "active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* --- Active Report Body --- */}
      {tab === "profit" && <ProfitReport range={range} />}
      {tab === "cashiers" && <CashierReport range={range} />}
      {tab === "customers" && <CustomerReport />}
      {tab === "inventory" && <InventoryReport />}
    </div>
  );
}

function useReport<T>(path: string, key: unknown[], query?: Record<string, string>) {
  const storeId = useSession((s) => s.storeId);

  return useQuery({
    queryKey: [...key, storeId],
    queryFn: () => api.get<T>(path, query),
    enabled: Boolean(storeId),
  });
}

function ReportState({ error, isLoading }: { error: unknown; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="dashboard-skeleton-wrap">
        <div className="skeleton-box" style={{ height: "6.5rem" }} />
        <div className="skeleton-box skeleton-chart" style={{ height: "20rem" }} />
      </div>
    );
  }

  const offline = error instanceof ApiError && error.isUnreachable;
  const forbidden = error instanceof ApiError && error.status === 403;

  return (
    <div className="action-alert-banner alert-warn-theme" role="status">
      <div className="alert-left-content">
        <AlertTriangle size={18} />
        <div className="alert-text-stack">
          <strong>
            {offline
              ? "Live reports require an active connection"
              : forbidden
                ? "Role Permission Required"
                : "Unable to load report figures"}
          </strong>
          <small>
            {offline
              ? "Reports aggregate transactions across every register in the store. Point of Sale checkout and cash sales remain 100% operational offline."
              : forbidden
                ? "Your user account does not possess clearance to view this financial report."
                : error instanceof Error
                  ? error.message
                  : "Please check your network and try again."}
          </small>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   1. Profit & Margin Report
   -------------------------------------------------------------------------- */
type ProfitResponse = {
  revenue_with_known_cost: string;
  cogs: string;
  gross_profit: string;
  margin_percent: string | null;
  lines_without_cost: number;
  lines_total: number;
  coverage_note: string | null;
  by_product: Array<{ product_id: string; name: string; units: number; revenue: string; cogs?: string }>;
};

function ProfitReport({ range }: { range: Range }) {
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const { data, error, isLoading } = useReport<ProfitResponse>("/api/reports/profit", ["profit", range.label], {
    from: range.from,
    to: range.to,
  });

  if (!data) return <ReportState error={error} isLoading={isLoading} />;

  const grossProfit = toMinor(data.gross_profit);
  const revenueKnown = toMinor(data.revenue_with_known_cost);
  const cogs = toMinor(data.cogs);
  const marginNum = data.margin_percent !== null ? Number(data.margin_percent) : null;

  const handlePrintPdf = () => {
    printTableAsPdf({
      title: `Product Profit & Margins (${range.label})`,
      columns: ["Product", "Units Sold", "Revenue", "Cost (COGS)", "Gross Profit", "Margin %"],
      rows: data.by_product.map((p) => {
        const rev = toMinor(p.revenue);
        const cost = p.cogs !== undefined ? toMinor(p.cogs) : 0;
        const profit = rev - cost;
        const margin = rev > 0 ? ((profit / rev) * 100).toFixed(1) + "%" : "—";
        return [
          p.name,
          String(p.units),
          formatMoney(rev, currency),
          p.cogs !== undefined ? formatMoney(cost, currency) : "—",
          cost > 0 ? formatMoney(profit, currency) : "—",
          margin,
        ];
      }),
    });
  };

  return (
    <>
      {/* 4 KPI Bento Cards */}
      <section className="reports-kpi-grid">
        <div className="reports-kpi-card">
          <div className="reports-kpi-top">
            <span className="reports-kpi-label">Revenue (Costed Lines)</span>
            <div className="reports-kpi-icon" style={{ background: "rgba(7, 103, 222, 0.12)", color: "#0767de" }}>
              <Coins size={17} />
            </div>
          </div>
          <strong className="reports-kpi-val">{formatMoney(revenueKnown, currency)}</strong>
          <span className="reports-kpi-sub">Lines with recorded cost price</span>
        </div>

        <div className="reports-kpi-card">
          <div className="reports-kpi-top">
            <span className="reports-kpi-label">Cost of Goods (COGS)</span>
            <div className="reports-kpi-icon" style={{ background: "rgba(254, 116, 3, 0.12)", color: "#fe7403" }}>
              <ShoppingBag size={17} />
            </div>
          </div>
          <strong className="reports-kpi-val">{formatMoney(cogs, currency)}</strong>
          <span className="reports-kpi-sub">Inventory acquisition cost</span>
        </div>

        <div className="reports-kpi-card">
          <div className="reports-kpi-top">
            <span className="reports-kpi-label">Gross Profit</span>
            <div className="reports-kpi-icon" style={{ background: "rgba(22, 163, 74, 0.12)", color: "#16a34a" }}>
              <TrendingUp size={17} />
            </div>
          </div>
          <strong className="reports-kpi-val" style={{ color: grossProfit >= 0 ? "var(--ok)" : "var(--danger)" }}>
            {formatMoney(grossProfit, currency)}
          </strong>
          <span className="reports-kpi-sub">Revenue minus acquisition cost</span>
        </div>

        <div className="reports-kpi-card">
          <div className="reports-kpi-top">
            <span className="reports-kpi-label">Average Margin</span>
            <div className="reports-kpi-icon" style={{ background: "rgba(139, 92, 246, 0.12)", color: "#8b5cf6" }}>
              <Sparkles size={17} />
            </div>
          </div>
          <strong className="reports-kpi-val">
            {marginNum !== null ? `${marginNum.toFixed(1)}%` : "—"}
          </strong>
          <span className="reports-kpi-sub">Overall costed margin percentage</span>
        </div>
      </section>

      {/* Warning on non-costed inventory lines */}
      {data.lines_without_cost > 0 && (
        <div className="action-alert-banner alert-warn-theme" role="status">
          <div className="alert-left-content">
            <AlertTriangle size={18} />
            <div className="alert-text-stack">
              <strong>Partial Cost Coverage Notice</strong>
              <small>
                {data.lines_without_cost} of {data.lines_total} sold lines have no recorded supplier cost and are
                excluded from margin computations. Enter product cost prices in Inventory to achieve 100% margin precision.
              </small>
            </div>
          </div>
        </div>
      )}

      {/* Breakdown by Product Card */}
      <div className="reports-card">
        <div className="reports-card-header">
          <div className="reports-header-title-group">
            <h2 className="reports-card-title">Profit Breakdown by Product</h2>
            <span className="settings-pill-badge" style={{ fontSize: "0.68rem" }}>
              {data.by_product.length} Products
            </span>
          </div>

          <button
            type="button"
            className="dashboard-refresh-btn"
            onClick={handlePrintPdf}
            title="Print or export profit table to PDF"
          >
            <Printer size={14} />
            <span>Print PDF</span>
          </button>
        </div>

        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Product</th>
                <th style={{ textAlign: "center" }}>Units Sold</th>
                <th style={{ textAlign: "right" }}>Revenue</th>
                <th style={{ textAlign: "right" }}>Cost (COGS)</th>
                <th style={{ textAlign: "right" }}>Gross Profit</th>
              </tr>
            </thead>
            <tbody>
              {data.by_product.map((p) => {
                const revenue = toMinor(p.revenue);
                const itemCogs = p.cogs === undefined ? null : toMinor(p.cogs);
                const profit = itemCogs !== null && itemCogs > 0 ? revenue - itemCogs : null;

                return (
                  <tr key={p.product_id}>
                    <td style={{ fontWeight: 750, color: "var(--text-strong)" }}>{p.name}</td>
                    <td style={{ textAlign: "center", fontWeight: 700 }}>{p.units}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(revenue, currency)}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>
                      {itemCogs === null ? "—" : formatMoney(itemCogs, currency)}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 800,
                        color: profit !== null ? (profit >= 0 ? "var(--ok)" : "var(--danger)") : "var(--muted)",
                      }}
                    >
                      {profit !== null ? formatMoney(profit, currency) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* --------------------------------------------------------------------------
   2. Cashier Audits Report
   -------------------------------------------------------------------------- */
type CashierResponse = {
  cashiers: Array<{
    user_id: string;
    name: string;
    orders: number;
    gross: string;
    shifts: number;
    cash_variance: string;
  }>;
};

function CashierReport({ range }: { range: Range }) {
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const { data, error, isLoading } = useReport<CashierResponse>("/api/reports/cashiers", ["cashiers", range.label], {
    from: range.from,
    to: range.to,
  });

  if (!data) return <ReportState error={error} isLoading={isLoading} />;

  const handlePrintPdf = () => {
    printTableAsPdf({
      title: `Cashier Audit Report (${range.label})`,
      columns: ["Cashier", "Sales Count", "Total Takings", "Drawers Counted", "Cash Variance"],
      rows: data.cashiers.map((c) => [
        c.name,
        String(c.orders),
        formatMoney(toMinor(c.gross), currency),
        String(c.shifts),
        formatMoney(toMinor(c.cash_variance), currency),
      ]),
    });
  };

  return (
    <div className="reports-card">
      <div className="reports-card-header">
        <div className="reports-header-title-group">
          <h2 className="reports-card-title">Cashier Register Performance & Audit</h2>
          <span className="settings-pill-badge" style={{ fontSize: "0.68rem" }}>
            {data.cashiers.length} Staff Members
          </span>
        </div>

        <button
          type="button"
          className="dashboard-refresh-btn"
          onClick={handlePrintPdf}
          title="Print or export cashier audits to PDF"
        >
          <Printer size={14} />
          <span>Print PDF</span>
        </button>
      </div>

      <div className="reports-table-wrap">
        <table className="reports-table">
          <thead>
            <tr>
              <th>Cashier Name</th>
              <th style={{ textAlign: "center" }}>Orders Rung</th>
              <th style={{ textAlign: "right" }}>Total Takings</th>
              <th style={{ textAlign: "center" }}>Drawers Counted</th>
              <th style={{ textAlign: "right" }}>Cash Variance</th>
            </tr>
          </thead>
          <tbody>
            {data.cashiers.map((c) => {
              const variance = toMinor(c.cash_variance);
              const isExact = variance === 0;

              return (
                <tr key={c.user_id}>
                  <td style={{ fontWeight: 750, color: "var(--text-strong)" }}>{c.name}</td>
                  <td style={{ textAlign: "center", fontWeight: 700 }}>{c.orders}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>
                    {formatMoney(toMinor(c.gross), currency)}
                  </td>
                  <td style={{ textAlign: "center" }}>{c.shifts}</td>
                  <td style={{ textAlign: "right" }}>
                    <span className={`variance-badge ${isExact ? "ok" : "diff"}`}>
                      {formatMoney(variance, currency)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="conflict-hint" style={{ marginTop: "0.5rem" }}>
        Variance is the cumulative sum of closing floats counted across all drawer sessions. Small variances are
        routine in busy retail environments; persistent discrepancies warrant reconciliation against physical till receipts.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------------
   3. Customer Accounts & Debtors Report
   -------------------------------------------------------------------------- */
type CustomerResponse = {
  top_customers: Array<{ id: string; name: string; phone: string | null; total_spend: string; outstanding_balance: string }>;
  debtors: Array<{ id: string; name: string; phone: string | null; outstanding_balance: string }>;
  total_outstanding: string;
};

function CustomerReport() {
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const { data, error, isLoading } = useReport<CustomerResponse>("/api/reports/customers", ["report-customers"]);

  if (!data) return <ReportState error={error} isLoading={isLoading} />;

  const totalOwed = toMinor(data.total_outstanding);

  return (
    <>
      <section className="reports-kpi-grid">
        <div className="reports-kpi-card">
          <div className="reports-kpi-top">
            <span className="reports-kpi-label">Total Store Debt</span>
            <div
              className="reports-kpi-icon"
              style={{
                background: totalOwed > 0 ? "rgba(220, 38, 38, 0.12)" : "rgba(22, 163, 74, 0.12)",
                color: totalOwed > 0 ? "var(--danger)" : "var(--ok)",
              }}
            >
              <Coins size={17} />
            </div>
          </div>
          <strong className="reports-kpi-val" style={{ color: totalOwed > 0 ? "var(--danger)" : "inherit" }}>
            {formatMoney(totalOwed, currency)}
          </strong>
          <span className="reports-kpi-sub">Total credit balance owed by customers</span>
        </div>

        <div className="reports-kpi-card">
          <div className="reports-kpi-top">
            <span className="reports-kpi-label">Active Debtors</span>
            <div className="reports-kpi-icon" style={{ background: "rgba(254, 116, 3, 0.12)", color: "#fe7403" }}>
              <Users size={17} />
            </div>
          </div>
          <strong className="reports-kpi-val">{data.debtors.length}</strong>
          <span className="reports-kpi-sub">Customers with unpaid account balances</span>
        </div>

        <div className="reports-kpi-card">
          <div className="reports-kpi-top">
            <span className="reports-kpi-label">Top VIP Spenders</span>
            <div className="reports-kpi-icon" style={{ background: "rgba(7, 103, 222, 0.12)", color: "#0767de" }}>
              <Sparkles size={17} />
            </div>
          </div>
          <strong className="reports-kpi-val">{data.top_customers.length}</strong>
          <span className="reports-kpi-sub">Highest lifetime store spenders</span>
        </div>
      </section>

      <div className="reports-two-col">
        {/* Debtors List */}
        <div className="reports-card">
          <div className="reports-card-header">
            <div className="reports-header-title-group">
              <h2 className="reports-card-title">Customers With Outstanding Debt</h2>
              <span className="settings-pill-badge" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
                {data.debtors.length} Owing
              </span>
            </div>
          </div>

          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th style={{ textAlign: "right" }}>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {data.debtors.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 750, color: "var(--text-strong)" }}>{c.name}</td>
                    <td style={{ fontSize: "0.76rem", color: "var(--muted)" }}>
                      {c.phone ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                          <Phone size={12} /> {c.phone}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 850, color: "var(--danger)" }}>
                      {formatMoney(toMinor(c.outstanding_balance), currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.debtors.length === 0 && (
            <p className="muted" style={{ padding: "1rem", textAlign: "center" }}>
              No outstanding customer balances. All accounts are settled!
            </p>
          )}
        </div>

        {/* Top VIP Spenders */}
        <div className="reports-card">
          <div className="reports-card-header">
            <div className="reports-header-title-group">
              <h2 className="reports-card-title">Top Spenders (VIP Customers)</h2>
              <span className="settings-pill-badge">{data.top_customers.length} VIPs</span>
            </div>
          </div>

          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th style={{ textAlign: "right" }}>Total Spent</th>
                  <th style={{ textAlign: "right" }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.top_customers.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 750, color: "var(--text-strong)" }}>{c.name}</td>
                    <td style={{ textAlign: "right", fontWeight: 800, color: "var(--accent-text)" }}>
                      {formatMoney(toMinor(c.total_spend), currency)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {toMinor(c.outstanding_balance) > 0 ? (
                        <span style={{ color: "var(--danger)", fontWeight: 750 }}>
                          {formatMoney(toMinor(c.outstanding_balance), currency)}
                        </span>
                      ) : (
                        <span style={{ color: "var(--ok)", fontSize: "0.78rem" }}>Settled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

/* --------------------------------------------------------------------------
   4. Inventory & Valuation Report
   -------------------------------------------------------------------------- */
type InventoryResponse = {
  low_stock: Array<{ id: string; name: string; sku: string; stock: number; reorder_level: number }>;
  oversold: Array<{ id: string; name: string; sku: string; stock: number }>;
  expiring_batches: Array<{ id: string; name: string; batch_number: string | null; quantity: number; expiry_date: string }>;
};

type ValuationResponse = {
  products: number;
  units: number;
  value_at_cost: string;
  value_at_retail: string;
  potential_margin: string;
};

function InventoryReport() {
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const can = useSession((s) => s.can);
  const { data, error, isLoading } = useReport<InventoryResponse>("/api/reports/inventory", ["report-inventory"]);

  const valuation = useQuery({
    queryKey: ["valuation"],
    queryFn: () => api.get<ValuationResponse>("/api/inventory/valuation"),
    enabled: can(["admin", "manager"]),
    retry: false,
  });

  if (!data) return <ReportState error={error} isLoading={isLoading} />;

  return (
    <>
      {/* Valuation Strip (Admin/Manager role) */}
      {valuation.data && (
        <section className="reports-kpi-grid">
          <div className="reports-kpi-card">
            <div className="reports-kpi-top">
              <span className="reports-kpi-label">Stock Value at Cost</span>
              <div className="reports-kpi-icon" style={{ background: "rgba(7, 103, 222, 0.12)", color: "#0767de" }}>
                <Coins size={17} />
              </div>
            </div>
            <strong className="reports-kpi-val">
              {formatMoney(toMinor(valuation.data.value_at_cost), currency)}
            </strong>
            <span className="reports-kpi-sub">Total capital tied up in inventory</span>
          </div>

          <div className="reports-kpi-card">
            <div className="reports-kpi-top">
              <span className="reports-kpi-label">Retail Value</span>
              <div className="reports-kpi-icon" style={{ background: "rgba(22, 163, 74, 0.12)", color: "#16a34a" }}>
                <DollarSign size={17} />
              </div>
            </div>
            <strong className="reports-kpi-val">
              {formatMoney(toMinor(valuation.data.value_at_retail), currency)}
            </strong>
            <span className="reports-kpi-sub">Shelf value at full list price</span>
          </div>

          <div className="reports-kpi-card">
            <div className="reports-kpi-top">
              <span className="reports-kpi-label">Potential Gross Margin</span>
              <div className="reports-kpi-icon" style={{ background: "rgba(139, 92, 246, 0.12)", color: "#8b5cf6" }}>
                <TrendingUp size={17} />
              </div>
            </div>
            <strong className="reports-kpi-val">
              {formatMoney(toMinor(valuation.data.potential_margin), currency)}
            </strong>
            <span className="reports-kpi-sub">Gross margin unrealized in stock</span>
          </div>

          <div className="reports-kpi-card">
            <div className="reports-kpi-top">
              <span className="reports-kpi-label">Catalogue Units</span>
              <div className="reports-kpi-icon" style={{ background: "rgba(6, 182, 212, 0.12)", color: "#06b6d4" }}>
                <Boxes size={17} />
              </div>
            </div>
            <strong className="reports-kpi-val">{valuation.data.units}</strong>
            <span className="reports-kpi-sub">Across {valuation.data.products} distinct products</span>
          </div>
        </section>
      )}

      {/* Oversold Alert Table */}
      {data.oversold.length > 0 && (
        <div className="reports-card" style={{ borderColor: "color-mix(in srgb, var(--danger) 40%, var(--line))" }}>
          <div className="reports-card-header">
            <div className="reports-header-title-group">
              <PackageX size={18} color="var(--danger)" />
              <h2 className="reports-card-title" style={{ color: "var(--danger)" }}>
                Oversold Inventory (Negative Stock Ledger)
              </h2>
              <span className="settings-pill-badge" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
                {data.oversold.length} Discrepancies
              </span>
            </div>
          </div>

          <p className="conflict-hint">
            The register allowed checkout to complete physical sales, but current stock is negative. Perform a physical
            stocktake count to reconcile records.
          </p>

          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th style={{ textAlign: "right" }}>Negative Stock</th>
                </tr>
              </thead>
              <tbody>
                {data.oversold.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 750, color: "var(--text-strong)" }}>{p.name}</td>
                    <td style={{ fontFamily: "monospace", color: "var(--muted)" }}>{p.sku}</td>
                    <td style={{ textAlign: "right", fontWeight: 850, color: "var(--danger)" }}>{p.stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="reports-two-col">
        {/* Low Stock Reorder List */}
        <div className="reports-card">
          <div className="reports-card-header">
            <div className="reports-header-title-group">
              <h2 className="reports-card-title">Low Stock Reorder Triggers</h2>
              <span className="settings-pill-badge">{data.low_stock.length} Items</span>
            </div>
          </div>

          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Stock</th>
                  <th style={{ textAlign: "right" }}>Reorder Threshold</th>
                </tr>
              </thead>
              <tbody>
                {data.low_stock.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 750, color: "var(--text-strong)" }}>{p.name}</td>
                    <td style={{ fontWeight: 800, color: "var(--cta)" }}>{p.stock}</td>
                    <td style={{ textAlign: "right", color: "var(--muted)" }}>{p.reorder_level}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.low_stock.length === 0 && (
            <p className="muted" style={{ padding: "1rem", textAlign: "center" }}>
              All inventory levels are above configured reorder thresholds.
            </p>
          )}
        </div>

        {/* Expiring Batches */}
        <div className="reports-card">
          <div className="reports-card-header">
            <div className="reports-header-title-group">
              <Clock size={18} color="var(--cta)" />
              <h2 className="reports-card-title">Expiring Batches (&lt;30 Days)</h2>
              <span className="settings-pill-badge" style={{ background: "var(--cta-soft)", color: "var(--cta)" }}>
                {data.expiring_batches.length} Batches
              </span>
            </div>
          </div>

          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Batch #</th>
                  <th>Qty</th>
                  <th style={{ textAlign: "right" }}>Expiry Date</th>
                </tr>
              </thead>
              <tbody>
                {data.expiring_batches.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 750, color: "var(--text-strong)" }}>{b.name}</td>
                    <td style={{ fontFamily: "monospace", color: "var(--muted)" }}>{b.batch_number ?? "—"}</td>
                    <td style={{ fontWeight: 750 }}>{b.quantity}</td>
                    <td style={{ textAlign: "right", color: "var(--danger)", fontWeight: 700 }}>
                      {new Date(b.expiry_date).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.expiring_batches.length === 0 && (
            <p className="muted" style={{ padding: "1rem", textAlign: "center" }}>
              No batches expiring within the next 30 days. Shelf life is optimal!
            </p>
          )}
        </div>
      </div>
    </>
  );
}
