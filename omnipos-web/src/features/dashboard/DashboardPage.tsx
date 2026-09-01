import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api, ApiError } from "@/api/client";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";

type Dashboard = {
  range: { from: string; to: string };
  sales: { gross: string; net: string; orders: number; average_order: string; refunds: string };
  profit: {
    revenue_with_known_cost: string;
    cogs: string;
    gross_profit: string;
    margin_percent: string | null;
    lines_without_cost: number;
    lines_total: number;
  };
  low_stock_count: number;
  outstanding_debt: string;
  top_products: Array<{ product_id: string; name: string; units: number; revenue: string }>;
  payments_by_method: Record<string, { total: string; count: number }>;
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  transfer: "Transfer",
  mobile_money: "Mobile money",
  store_credit: "Store credit",
  loyalty: "Loyalty",
  other: "Other",
};

type Period = { label: string; days: number | null };

const PERIODS: Period[] = [
  { label: "Today", days: null },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
];

function queryFor(period: Period): Record<string, string> | undefined {
  // No dates at all means the server's own default, which is today in the
  // store's timezone. Sending a locally computed "today" would use the browser's
  // timezone instead, and a shop an hour either side of the server would see the
  // day start and end at the wrong moment.
  if (period.days === null) return undefined;

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - period.days);

  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/**
 * The dashboard is the one screen that genuinely needs the server: it aggregates
 * across every till, not just this one. It degrades to a clear message rather
 * than pretending, because a figure that silently covers one terminal's sales
 * would be worse than no figure at all.
 */
export function DashboardPage() {
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const storeId = useSession((s) => s.storeId);
  const can = useSession((s) => s.can);

  const [period, setPeriod] = useState(PERIODS[0]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", storeId, period.label],
    queryFn: () => api.get<Dashboard>("/api/reports/dashboard", queryFor(period)),
    enabled: Boolean(storeId),
  });

  const header = (
    <header className="page-header">
      <h1>{period.label === "Today" ? "Today" : `Last ${period.label}`}</h1>
      <div className="page-actions">
        {PERIODS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={p.label === period.label ? "chip chip-active" : "chip"}
            onClick={() => setPeriod(p)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </header>
  );

  if (isLoading) {
    return <div className="page">{header}<p className="muted">Loading…</p></div>;
  }

  if (error || !data) {
    const offline = error instanceof ApiError && error.isUnreachable;
    return (
      <div className="page">
        {header}
        <p className="notice notice-warn">
          {offline
            ? "These figures cover every till in the store, so they need a connection. Selling still works offline."
            : error instanceof Error
              ? error.message
              : "Could not load the dashboard."}
        </p>
      </div>
    );
  }

  const gross = toMinor(data.sales.gross);
  const refunds = toMinor(data.sales.refunds);
  const net = toMinor(data.sales.net);
  const debt = toMinor(data.outstanding_debt);

  const methods = Object.entries(data.payments_by_method ?? {})
    .map(([method, row]) => ({ method, total: toMinor(row.total), count: row.count }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="page">
      {header}

      <div className="kpi-grid">
        <Kpi label="Gross sales" value={formatMoney(gross, currency)} hint={`${data.sales.orders} sales`} />
        {/*
          Refunds get their own tile even at zero. Without it a negative net
          appears from nowhere — which is exactly what happens when a refund
          lands on a day whose own sales have not started yet.
        */}
        <Kpi
          label="Refunds"
          value={formatMoney(refunds, currency)}
          tone={refunds > 0 ? "warn" : undefined}
        />
        <Kpi
          label="Net"
          value={formatMoney(net, currency)}
          hint={net < 0 ? "refunds exceeded sales in this period" : undefined}
          tone={net < 0 ? "warn" : undefined}
        />
        <Kpi label="Average sale" value={formatMoney(toMinor(data.sales.average_order), currency)} />

        {can(["admin", "manager"]) && (
          <Kpi
            label="Gross profit"
            value={formatMoney(toMinor(data.profit.gross_profit), currency)}
            hint={
              data.profit.lines_without_cost > 0
                ? `${data.profit.lines_without_cost} of ${data.profit.lines_total} lines have no cost and are excluded`
                : data.profit.margin_percent !== null
                  ? `${Number(data.profit.margin_percent).toFixed(1)}% margin`
                  : "nothing sold with a recorded cost"
            }
          />
        )}

        <Kpi
          label="Low stock"
          value={String(data.low_stock_count)}
          tone={data.low_stock_count > 0 ? "warn" : undefined}
          to={data.low_stock_count > 0 ? "/reports" : undefined}
        />
        <Kpi
          label="Customer debt"
          value={formatMoney(debt, currency)}
          tone={debt > 0 ? "warn" : undefined}
          to={debt > 0 ? "/customers" : undefined}
          hint={debt > 0 ? "across all customers, not just this period" : undefined}
        />
      </div>

      {methods.length > 0 && (
        <section>
          <h2>How it was paid</h2>
          <table className="table">
            <thead><tr><th>Method</th><th>Payments</th><th>Total</th></tr></thead>
            <tbody>
              {methods.map((m) => (
                <tr key={m.method}>
                  <td>{METHOD_LABELS[m.method] ?? m.method}</td>
                  <td>{m.count}</td>
                  <td className={m.total < 0 ? "danger-text" : undefined}>{formatMoney(m.total, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/*
            These are payments, not sales: settling an old debt appears here and
            not in gross, and a refund appears as a negative. Saying so stops the
            obvious "why don't these add up" question.
          */}
          <p className="conflict-hint">
            Money that moved in this period. A debt settled today shows here but not in sales, and a refund shows as
            a negative.
          </p>
        </section>
      )}

      <section>
        <h2>Top products</h2>
        {data.top_products.length === 0 ? (
          <p className="muted">Nothing sold in this period.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Product</th><th>Units</th><th>Revenue</th></tr></thead>
            <tbody>
              {data.top_products.map((p) => (
                <tr key={p.product_id}>
                  <td>{p.name}</td>
                  <td>{p.units}</td>
                  <td>{formatMoney(toMinor(p.revenue), currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  to,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warn";
  to?: string;
}) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {hint && <span className="kpi-hint">{hint}</span>}
    </>
  );

  const className = tone === "warn" ? "kpi kpi-warn" : "kpi";

  // A figure that needs acting on links to the screen where you act on it.
  // Numbers with nothing to do about them stay inert rather than offering a
  // click that goes nowhere useful.
  return to ? <Link to={to} className={`${className} kpi-link`}>{body}</Link> : <div className={className}>{body}</div>;
}
