import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, BarChart3, Box, CheckCircle2, ChevronRight, CircleDollarSign, Clock3, Package, Receipt, ShoppingCart, Store, TrendingUp, Users } from "lucide-react";

import { api, ApiError } from "@/api/client";
import { db, type LocalBatch, type LocalOrder } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { expiryStatus } from "@/features/products/expiry";
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
  const recentOrders = useLiveQuery(
    () => storeId ? db.orders.where("store_id").equals(storeId).reverse().sortBy("client_created_at") : Promise.resolve([] as LocalOrder[]),
    [storeId],
    [] as LocalOrder[],
  );
  const batches = useLiveQuery(
    () => storeId ? db.batches.where("store_id").equals(storeId).toArray() : Promise.resolve([] as LocalBatch[]),
    [storeId],
    [] as LocalBatch[],
  );

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
        <p className="dashboard-toast dashboard-toast-error" role="status">
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

  const maxPayment = Math.max(...methods.map((method) => method.total), 1);
  const recent = recentOrders.slice(-4).reverse();
  const expiredBatches = batches.filter((batch) => Number(batch.quantity) > 0 && expiryStatus(batch.expiry_date).status === "expired").length;
  const expiringBatches = batches.filter((batch) => Number(batch.quantity) > 0 && expiryStatus(batch.expiry_date).status === "expiring_soon").length;
  const shortcuts = [
    { label: "Create Order", subtitle: "POS sale & checkout", icon: ShoppingCart, to: "/" },
    { label: "Cash Drawer", subtitle: "Shifts & Z-Reports", icon: CircleDollarSign, to: "/shift" },
    { label: "Inventory", subtitle: "Stock & batch tracking", icon: Box, to: "/products" },
    { label: "Customers CRM", subtitle: "Accounts & credit", icon: Users, to: "/customers" },
    { label: "Returns", subtitle: "Refund & restock", icon: TrendingUp, to: "/returns" },
    { label: "Reports", subtitle: "Sales & revenue charts", icon: BarChart3, to: "/reports" },
  ];

  return (
    <div className="page dashboard-page">
      <header className="dashboard-page-header">
        <div className="dashboard-title"><Store size={20} aria-hidden="true" /><div><h1>{period.label === "Today" ? "Good day" : `Last ${period.label}`}</h1><p>{period.label === "Today" ? "Here is what is happening in your store today." : "Store performance at a glance."}</p></div></div>
        <div className="dashboard-periods">{PERIODS.map((p) => <button key={p.label} type="button" className={p.label === period.label ? "active" : ""} onClick={() => setPeriod(p)}>{p.label}</button>)}</div>
      </header>

      <section className="dashboard-hero">
        <div><span className="dashboard-live"><i /> STORE ONLINE</span><h2>{useSession.getState().store?.name ?? "OmniPOS Store"}</h2><p>{period.label === "Today" ? "Your store performance is being tracked live." : `Reviewing performance for the ${period.label.toLowerCase()}.`}</p></div>
        <Link to="/" className="dashboard-new-sale"><ShoppingCart size={18} /> New Sale</Link>
      </section>

      {data.low_stock_count > 0 && <Link to="/products" className="dashboard-alert dashboard-alert-warn"><AlertTriangle size={21} /><span><strong>Low Stock Warning</strong><small>{data.low_stock_count} product{data.low_stock_count === 1 ? " is" : "s are"} at or below reorder level. Tap to restock.</small></span><ChevronRight size={18} /></Link>}
      {(expiredBatches > 0 || expiringBatches > 0) && <Link to="/products" className="dashboard-alert dashboard-alert-danger"><Clock3 size={21} /><span><strong>Batch Expiry Alert</strong><small>{expiredBatches > 0 ? `${expiredBatches} batch(es) expired.` : ""}{expiredBatches > 0 && expiringBatches > 0 ? " " : ""}{expiringBatches > 0 ? `${expiringBatches} batch(es) expiring soon (<30d).` : ""}</small></span><ChevronRight size={18} /></Link>}

      <div className="dashboard-kpi-grid">
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

      <section className="dashboard-section">
        <div className="dashboard-section-heading"><span><TrendingUp size={18} /> 7-Day Revenue Velocity</span><em>Live Chart</em></div>
        <div className="dashboard-revenue-chart">{methods.length > 0 ? methods.slice(0, 7).map((method) => <div key={method.method} className="dashboard-chart-column"><i style={{ height: `${Math.max(8, (method.total / maxPayment) * 100)}%` }} /><small>{METHOD_LABELS[method.method] ?? method.method}</small></div>) : <p className="muted">No payment activity in this period.</p>}</div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading"><span><BarChart3 size={18} /> Orders vs Returns Volume</span><em>This period</em></div>
        <div className="dashboard-volume"><div><strong>{data.sales.orders}</strong><small>Orders</small></div><div><strong>{data.sales.refunds !== "0" ? formatMoney(refunds, currency) : "0"}</strong><small>Returns</small></div><div className="dashboard-volume-track"><i style={{ width: `${Math.min(100, data.sales.orders ? 100 : 0)}%` }} /></div></div>
      </section>

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

      <section className="dashboard-section">
        <div className="dashboard-section-heading"><span><TrendingUp size={18} /> Top Selling Products</span><Link to="/products">View All</Link></div>
        {data.top_products.length === 0 ? (
          <p className="muted">Nothing sold in this period.</p>
        ) : (
          <div className="dashboard-top-products">
              {data.top_products.map((p) => (
                <div key={p.product_id}><b>#{data.top_products.indexOf(p) + 1}</b><span><strong>{p.name}</strong><small>{p.units} units sold</small></span><em>{formatMoney(toMinor(p.revenue), currency)}</em></div>
              ))}
          </div>
        )}
      </section>

      {recent.length > 0 && <section className="dashboard-section"><div className="dashboard-section-heading"><span><Receipt size={18} /> Recent Transactions</span><Link to="/orders">All Orders</Link></div><div className="dashboard-transactions">{recent.map((order) => <Link key={order.id} to={`/receipt/${order.id}`}><CheckCircle2 size={20} /><span><strong>#{order.order_number}</strong><small>{order.customer_name ?? "Walk-in Customer"}</small></span><em>{formatMoney(toMinor(order.total), currency)}<small>{toMinor(order.amount_paid) < toMinor(order.total) ? "Partial / Credit" : "Paid"}</small></em><ChevronRight size={14} /></Link>)}</div></section>}

      <section className="dashboard-section"><div className="dashboard-section-heading"><span><Package size={18} /> Management Hub</span><em>{shortcuts.length} tools</em></div><div className="dashboard-shortcuts">{shortcuts.map(({ label, subtitle, icon: Icon, to }) => <Link key={label} to={to}><span><Icon size={20} /></span><b>{label}<small>{subtitle}</small></b><ChevronRight size={14} /></Link>)}</div></section>
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
