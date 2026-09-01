import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";

import { api, ApiError } from "@/api/client";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";

type Range = { from: string; to: string; label: string };

function rangeFor(days: number, label: string): Range {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label };
}

const RANGES = [rangeFor(7, "7 days"), rangeFor(30, "30 days"), rangeFor(90, "90 days")];

const TABS = [
  { key: "profit", label: "Profit", roles: ["admin", "manager"] },
  { key: "cashiers", label: "Cashiers", roles: ["admin", "manager"] },
  { key: "customers", label: "Customers" },
  { key: "inventory", label: "Inventory" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * Reports across every till in the store.
 *
 * All of it comes from the server, and that is not a shortcut: one terminal's
 * local database only knows its own sales, so computing any of this locally
 * would quietly report a fraction of the business under a name that implies the
 * whole of it. When there is no connection the page says so rather than showing
 * a number that looks complete.
 */
export function ReportsPage() {
  const can = useSession((s) => s.can);
  const [tab, setTab] = useState<TabKey>(can(["admin", "manager"]) ? "profit" : "customers");
  const [range, setRange] = useState(RANGES[1]);

  const visible = TABS.filter((t) => !("roles" in t) || can([...t.roles]));

  return (
    <div className="page">
      <header className="page-header">
        <h1><BarChart3 size={20} aria-hidden="true" /> Reports</h1>
        <div className="page-actions">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              className={r.label === range.label ? "chip chip-active" : "chip"}
              onClick={() => setRange(r)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      <div className="pos-categories">
        {visible.map((t) => (
          <button
            key={t.key}
            type="button"
            className={t.key === tab ? "chip chip-active" : "chip"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

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
  if (isLoading) return <p className="muted">Loading…</p>;

  const offline = error instanceof ApiError && error.isUnreachable;
  const forbidden = error instanceof ApiError && error.status === 403;

  return (
    <p className="notice notice-warn">
      {offline
        ? "These figures cover every till, so they need a connection. Selling still works offline."
        : forbidden
          ? "Your role does not have access to these figures."
          : error instanceof Error
            ? error.message
            : "Could not load this report."}
    </p>
  );
}

type ProfitResponse = {
  /** Revenue from lines that have a recorded cost. Others are excluded entirely. */
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

  return (
    <>
      <div className="kpi-grid">
        {/* Named for what it is. "Revenue" here is not the shop's takings — it
            is only the part of them whose cost is known, and calling it revenue
            would invite it to be compared against the sales report. */}
        <Kpi label="Revenue with known cost" value={formatMoney(toMinor(data.revenue_with_known_cost), currency)} />
        <Kpi label="Cost of goods" value={formatMoney(toMinor(data.cogs), currency)} />
        <Kpi label="Gross profit" value={formatMoney(toMinor(data.gross_profit), currency)} />
        <Kpi
          label="Margin"
          value={data.margin_percent === null ? "—" : `${Number(data.margin_percent).toFixed(1)}%`}
        />
      </div>

      {/*
        Stated rather than buried. Lines sold before a cost price was recorded
        are left out of both sides of the calculation, so the margin above is
        real but covers less of the business than it looks like it does.
      */}
      {data.lines_without_cost > 0 && (
        <p className="notice notice-warn">
          {data.lines_without_cost} of {data.lines_total} sold lines have no recorded cost and are excluded from
          these figures entirely. The margin shown is accurate for the rest; it is not the whole shop.
        </p>
      )}

      <table className="table">
        <thead>
          <tr><th>Product</th><th>Units</th><th>Revenue</th><th>Cost</th><th>Profit</th></tr>
        </thead>
        <tbody>
          {data.by_product.map((p) => {
            const revenue = toMinor(p.revenue);
            const cogs = p.cogs === undefined ? null : toMinor(p.cogs);
            return (
              <tr key={p.product_id}>
                <td>{p.name}</td>
                <td>{p.units}</td>
                <td>{formatMoney(revenue, currency)}</td>
                <td>{cogs === null ? "—" : formatMoney(cogs, currency)}</td>
                {/* Per-product revenue includes lines with no cost, so this
                    subtraction can flatter one product even while the totals
                    above are honest. Shown as a dash rather than a wrong number
                    when nothing on this product had a cost. */}
                <td>{cogs === null || cogs === 0 ? "—" : formatMoney(revenue - cogs, currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

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

  return (
    <>
      <table className="table">
        <thead>
          <tr><th>Cashier</th><th>Sales</th><th>Takings</th><th>Drawers counted</th><th>Cash variance</th></tr>
        </thead>
        <tbody>
          {data.cashiers.map((c) => {
            const variance = toMinor(c.cash_variance);
            return (
              <tr key={c.user_id}>
                <td>{c.name}</td>
                <td>{c.orders}</td>
                <td>{formatMoney(toMinor(c.gross), currency)}</td>
                <td>{c.shifts}</td>
                <td className={variance !== 0 ? "danger-text" : undefined}>
                  {formatMoney(variance, currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/*
        A variance is not an accusation, and this report will be read by
        someone's manager. Saying so is the difference between a tool for
        finding miscounts and a tool for blaming people.
      */}
      <p className="conflict-hint">
        Variance is the sum of every drawer this cashier counted, over or short. Small differences are ordinary —
        miscounted change, a note stuck to another. It is a pattern over time that means something.
      </p>
    </>
  );
}

type CustomerResponse = {
  top_customers: Array<{ id: string; name: string; phone: string | null; total_spend: string; outstanding_balance: string }>;
  debtors: Array<{ id: string; name: string; phone: string | null; outstanding_balance: string }>;
  total_outstanding: string;
};

function CustomerReport() {
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const { data, error, isLoading } = useReport<CustomerResponse>("/api/reports/customers", ["report-customers"]);

  if (!data) return <ReportState error={error} isLoading={isLoading} />;

  return (
    <>
      <div className="kpi-grid">
        <Kpi label="Owed to the shop" value={formatMoney(toMinor(data.total_outstanding), currency)} />
        <Kpi label="Customers owing" value={String(data.debtors.length)} />
      </div>

      <h2 className="settings-subhead">Who owes the most</h2>
      <table className="table">
        <thead><tr><th>Customer</th><th>Phone</th><th>Outstanding</th></tr></thead>
        <tbody>
          {data.debtors.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td className="mono">{c.phone ?? "—"}</td>
              <td className="danger-text">{formatMoney(toMinor(c.outstanding_balance), currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.debtors.length === 0 && <p className="muted">Nobody owes anything.</p>}

      <h2 className="settings-subhead">Best customers</h2>
      <table className="table">
        <thead><tr><th>Customer</th><th>Spent</th><th>Owing</th></tr></thead>
        <tbody>
          {data.top_customers.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{formatMoney(toMinor(c.total_spend), currency)}</td>
              <td>{formatMoney(toMinor(c.outstanding_balance), currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

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

  // Cost prices across the whole catalogue disclose supplier pricing, so the
  // server restricts this to roles that may see cost. A cashier simply does not
  // see the section rather than seeing an error.
  const valuation = useQuery({
    queryKey: ["valuation"],
    queryFn: () => api.get<ValuationResponse>("/api/inventory/valuation"),
    enabled: can(["admin", "manager"]),
    retry: false,
  });

  if (!data) return <ReportState error={error} isLoading={isLoading} />;

  return (
    <>
      {valuation.data && (
        <>
          <h2 className="settings-subhead">What the stock is worth</h2>
          <div className="kpi-grid">
            <Kpi label="At cost" value={formatMoney(toMinor(valuation.data.value_at_cost), currency)} />
            <Kpi label="At retail" value={formatMoney(toMinor(valuation.data.value_at_retail), currency)} />
            <Kpi label="Margin in stock" value={formatMoney(toMinor(valuation.data.potential_margin), currency)} />
            <Kpi label="Units" value={`${valuation.data.units} across ${valuation.data.products}`} />
          </div>
          {/* Retail value is what the shelves would fetch if everything sold at
              list. It is not money the shop has, and labelling it plainly stops
              it being read as one. */}
          <p className="conflict-hint">
            Retail value assumes everything sells at full price. It is what the shelves could fetch, not what the
            shop holds.
          </p>
        </>
      )}

      {/*
        Oversold first. Negative stock means the shelf and the books already
        disagree, which is a today problem; a reorder level is a next-week one.
      */}
      {data.oversold.length > 0 && (
        <>
          <h2 className="settings-subhead">Sold more than the books had</h2>
          <p className="conflict-hint">
            Allowed on purpose — a till never refuses a sale the shop can physically fulfil. These need counting.
          </p>
          <table className="table">
            <thead><tr><th>Product</th><th>SKU</th><th>Stock</th></tr></thead>
            <tbody>
              {data.oversold.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="mono">{p.sku}</td>
                  <td className="danger-text">{p.stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2 className="settings-subhead">Running low</h2>
      <table className="table">
        <thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Reorder at</th></tr></thead>
        <tbody>
          {data.low_stock.map((p) => (
            <tr key={p.id} className="row-warn">
              <td>{p.name}</td>
              <td className="mono">{p.sku}</td>
              <td>{p.stock}</td>
              <td className="muted">{p.reorder_level}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.low_stock.length === 0 && <p className="muted">Nothing is below its reorder level.</p>}

      {data.expiring_batches.length > 0 && (
        <>
          <h2 className="settings-subhead">Expiring within 30 days</h2>
          <table className="table">
            <thead><tr><th>Product</th><th>Batch</th><th>Quantity</th><th>Expires</th></tr></thead>
            <tbody>
              {data.expiring_batches.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td className="mono">{b.batch_number ?? "—"}</td>
                  <td>{b.quantity}</td>
                  <td>{new Date(b.expiry_date).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
    </div>
  );
}
