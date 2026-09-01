import { useQuery } from "@tanstack/react-query";

import { api, ApiError } from "@/api/client";
import type { LocalCustomer } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";

/**
 * orders and payments come back as bare arrays, not paginated envelopes — the
 * controller calls ->get() rather than ->paginate(). A statement is a whole
 * account by definition, so there is nothing to page through.
 */
type Statement = {
  orders: Array<{ id: string; order_number: string; total: string; amount_paid: string; client_created_at: string | null; status: string }>;
  payments: Array<{ id: string; amount: string; method: string; order_id: string | null; created_at: string | null; client_created_at: string | null; notes: string | null }>;
  summary: {
    orders_count: number;
    total_invoiced: string;
    total_paid: string;
    outstanding_balance: string;
    unpaid_orders: number;
    last_purchase_at: string | null;
  };
};

type Entry = {
  key: string;
  at: string;
  description: string;
  charge: number;
  credit: number;
};

type Props = {
  customer: LocalCustomer;
  onClose: () => void;
};

/**
 * What a customer bought, what they paid, and what is left.
 *
 * Server-side because it must cover every till. A customer buys at one counter
 * and settles at another, so a statement built from one device's records would
 * show charges without their payments — and the person reading it would be
 * asking for money that has already been handed over.
 */
export function StatementDialog({ customer, onClose }: Props) {
  const currency = useSession((s) => s.store?.currency) ?? "GHS";

  const { data, error, isLoading } = useQuery({
    queryKey: ["statement", customer.id],
    queryFn: () => api.get<Statement>(`/api/customers/${customer.id}/statement`),
  });

  const offline = error instanceof ApiError && error.isUnreachable;

  // Charges and credits interleaved in the order they happened, which is the
  // only arrangement that lets someone follow how the balance got where it is.
  const entries: Entry[] = data
    ? [
        ...data.orders.map((o) => ({
          key: `o-${o.id}`,
          at: o.client_created_at ?? "",
          description: `${o.order_number}${o.status === "voided" ? " (voided)" : ""}`,
          charge: o.status === "voided" ? 0 : toMinor(o.total),
          credit: 0,
        })),
        ...data.payments.map((p) => ({
          key: `p-${p.id}`,
          at: p.client_created_at ?? p.created_at ?? "",
          description: p.notes || `Paid by ${p.method.replace("_", " ")}`,
          charge: 0,
          // Refunds are negative rows in the same ledger, so a negative credit
          // is money going back out. Shown as it is rather than hidden.
          credit: toMinor(p.amount),
        })),
      ].sort((a, b) => a.at.localeCompare(b.at))
    : [];

  let running = 0;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Statement for ${customer.name}`}>
      <div className="modal modal-wide">
        <header className="conflict-head">
          <div>
            <h2>{customer.name}</h2>
            {customer.phone && <p className="muted mono">{customer.phone}</p>}
          </div>
          <div className="conflict-amount">
            {formatMoney(toMinor(data?.summary.outstanding_balance ?? customer.outstanding_balance), currency)} owing
          </div>
        </header>

        {isLoading && <p className="muted">Loading…</p>}

        {error && (
          <p className="notice notice-warn">
            {offline
              ? "A statement has to cover every till, so it needs a connection. This device only saw its own sales."
              : error instanceof Error
                ? error.message
                : "Could not load the statement."}
          </p>
        )}

        {data && (
          <>
            <div className="kpi-grid">
              <div className="kpi">
                <span className="kpi-label">Invoiced</span>
                <span className="kpi-value">{formatMoney(toMinor(data.summary.total_invoiced), currency)}</span>
              </div>
              <div className="kpi">
                <span className="kpi-label">Paid</span>
                <span className="kpi-value">{formatMoney(toMinor(data.summary.total_paid), currency)}</span>
              </div>
              <div className="kpi">
                <span className="kpi-label">Sales</span>
                <span className="kpi-value">{data.summary.orders_count}</span>
                <span className="kpi-hint">{data.summary.unpaid_orders} not fully paid</span>
              </div>
            </div>

            <table className="table">
              <thead>
                <tr><th>When</th><th>What</th><th>Charged</th><th>Paid</th><th>Balance</th></tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  running += e.charge - e.credit;
                  return (
                    <tr key={e.key}>
                      <td>{e.at ? new Date(e.at).toLocaleDateString() : "—"}</td>
                      <td>{e.description}</td>
                      <td>{e.charge > 0 ? formatMoney(e.charge, currency) : "—"}</td>
                      <td>{e.credit !== 0 ? formatMoney(e.credit, currency) : "—"}</td>
                      <td className={running > 0 ? "danger-text" : undefined}>{formatMoney(running, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {entries.length === 0 && <p className="muted">Nothing on this account yet.</p>}
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="link" onClick={() => window.print()}>Print</button>
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
