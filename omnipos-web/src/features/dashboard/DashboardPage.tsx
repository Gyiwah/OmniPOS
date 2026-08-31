import { useQuery } from "@tanstack/react-query";

import { api, ApiError } from "@/api/client";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";

type Dashboard = {
  sales: { gross: string; net: string; orders: number; average_order: string; refunds: string };
  profit: { gross_profit: string; margin_percent: string | null; lines_without_cost: number };
  low_stock_count: number;
  outstanding_debt: string;
  top_products: Array<{ product_id: string; name: string; units: number; revenue: string }>;
};

/**
 * The dashboard is the one screen that genuinely needs the server: it aggregates
 * across every till, not just this one. It degrades to a clear message rather
 * than pretending, because a figure that silently covers one terminal's sales
 * would be worse than no figure at all.
 */
export function DashboardPage() {
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const storeId = useSession((s) => s.storeId);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", storeId],
    queryFn: () => api.get<Dashboard>("/api/reports/dashboard"),
    enabled: Boolean(storeId),
  });

  if (isLoading) return <div className="page"><p className="muted">Loading today's figures…</p></div>;

  if (error) {
    const offline = error instanceof ApiError && error.isUnreachable;
    return (
      <div className="page">
        <h1>Dashboard</h1>
        <p className="notice notice-warn">
          {offline
            ? "These figures cover every till in the store, so they need a connection. Selling still works offline."
            : "Could not load the dashboard."}
        </p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="page">
      <header className="page-header"><h1>Today</h1></header>

      <div className="kpi-grid">
        <Kpi label="Gross sales" value={formatMoney(toMinor(data.sales.gross), currency)} />
        <Kpi label="Net of refunds" value={formatMoney(toMinor(data.sales.net), currency)} />
        <Kpi label="Orders" value={String(data.sales.orders)} />
        <Kpi label="Average sale" value={formatMoney(toMinor(data.sales.average_order), currency)} />
        <Kpi
          label="Gross profit"
          value={formatMoney(toMinor(data.profit.gross_profit), currency)}
          hint={
            data.profit.lines_without_cost > 0
              ? `${data.profit.lines_without_cost} line(s) have no recorded cost and are excluded`
              : data.profit.margin_percent
                ? `${data.profit.margin_percent}% margin`
                : undefined
          }
        />
        <Kpi label="Low stock" value={String(data.low_stock_count)} tone={data.low_stock_count > 0 ? "warn" : undefined} />
        <Kpi
          label="Customer debt"
          value={formatMoney(toMinor(data.outstanding_debt), currency)}
          tone={toMinor(data.outstanding_debt) > 0 ? "warn" : undefined}
        />
      </div>

      <section>
        <h2>Top products today</h2>
        {data.top_products.length === 0 ? (
          <p className="muted">No sales yet today.</p>
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

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div className={tone === "warn" ? "kpi kpi-warn" : "kpi"}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  );
}
