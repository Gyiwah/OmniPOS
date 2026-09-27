import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  X,
  Printer,
  AlertTriangle,
} from "lucide-react";

import { api, ApiError } from "@/api/client";
import type { LocalCustomer } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { printTableAsPdf } from "@/utils/printTable";

type Statement = {
  orders: Array<{
    id: string;
    order_number: string;
    total: string;
    amount_paid: string;
    client_created_at: string | null;
    status: string;
  }>;
  payments: Array<{
    id: string;
    amount: string;
    method: string;
    order_id: string | null;
    created_at: string | null;
    client_created_at: string | null;
    notes: string | null;
  }>;
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
 * Customer Statement & Transaction Chronology Ledger
 *
 * Shows full transaction history across all terminals in the store.
 */
export function StatementDialog({ customer, onClose }: Props) {
  const currency = useSession((s) => s.store?.currency) ?? "GHS";

  const { data, error, isLoading } = useQuery({
    queryKey: ["statement", customer.id],
    queryFn: () => api.get<Statement>(`/api/customers/${customer.id}/statement`),
  });

  const offline = error instanceof ApiError && error.isUnreachable;

  const entries: Entry[] = data
    ? [
        ...data.orders.map((o) => ({
          key: `o-${o.id}`,
          at: o.client_created_at ?? "",
          description: `Sale ${o.order_number}${o.status === "voided" ? " (voided)" : ""}`,
          charge: o.status === "voided" ? 0 : toMinor(o.total),
          credit: 0,
        })),
        ...data.payments.map((p) => ({
          key: `p-${p.id}`,
          at: p.client_created_at ?? p.created_at ?? "",
          description: p.notes || `Payment via ${p.method.replace("_", " ")}`,
          charge: 0,
          credit: toMinor(p.amount),
        })),
      ].sort((a, b) => a.at.localeCompare(b.at))
    : [];

  let running = 0;

  const handleExportPdf = () => {
    let balanceCalc = 0;
    printTableAsPdf({
      title: `Account Statement - ${customer.name}`,
      columns: ["Date", "Description", "Charged", "Paid", "Balance"],
      rows: entries.map((e) => {
        balanceCalc += e.charge - e.credit;
        return [
          e.at ? new Date(e.at).toLocaleDateString() : "—",
          e.description,
          e.charge > 0 ? formatMoney(e.charge, currency) : "—",
          e.credit !== 0 ? formatMoney(e.credit, currency) : "—",
          formatMoney(balanceCalc, currency),
        ];
      }),
    });
  };

  const owingBalance = toMinor(data?.summary.outstanding_balance ?? customer.outstanding_balance);

  return (
    <div
      className="customer-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Statement for ${customer.name}`}
    >
      <div className="customer-modal-box customer-modal-wide">
        {/* Header */}
        <div className="customer-modal-header">
          <h2 className="customer-modal-title">
            <FileText size={18} />
            <span>Account Statement</span>
          </h2>
          <button
            type="button"
            className="customers-clear-btn"
            onClick={onClose}
            aria-label="Close statement"
          >
            <X size={18} />
          </button>
        </div>

        <div className="customer-modal-body">
          {/* Customer Profile Banner */}
          <div
            style={{
              padding: "1rem 1.25rem",
              background: "var(--panel-2)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--line)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.75rem",
            }}
          >
            <div>
              <strong style={{ fontSize: "1.1rem", color: "var(--text-strong)", display: "block" }}>
                {customer.name}
              </strong>
              <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.2rem" }}>
                {customer.phone && <span>Phone: {customer.phone}</span>}
                {customer.email && <span>Email: {customer.email}</span>}
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: "0.74rem", textTransform: "uppercase", fontWeight: 700, color: "var(--muted)", display: "block" }}>
                Current Balance
              </span>
              <strong
                style={{
                  fontSize: "1.35rem",
                  color: owingBalance > 0 ? "var(--danger)" : "var(--ok)",
                  letterSpacing: "-0.01em",
                }}
              >
                {formatMoney(owingBalance, currency)} {owingBalance > 0 ? "Due" : "Settled"}
              </strong>
            </div>
          </div>

          {isLoading && (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
              Loading account statement from server…
            </div>
          )}

          {error && (
            <div className="returns-auth-notice warn">
              <AlertTriangle size={18} />
              <span>
                {offline
                  ? "Live statements aggregate transactions across all tills and require an active connection."
                  : error instanceof Error
                    ? error.message
                    : "Could not load statement."}
              </span>
            </div>
          )}

          {data && (
            <>
              {/* Financial KPI Summary Bento */}
              <div className="statement-kpi-bar">
                <div className="statement-kpi-card">
                  <span className="payment-summary-label">Total Invoiced</span>
                  <strong className="payment-summary-val">
                    {formatMoney(toMinor(data.summary.total_invoiced), currency)}
                  </strong>
                </div>

                <div className="statement-kpi-card">
                  <span className="payment-summary-label">Total Paid</span>
                  <strong className="payment-summary-val" style={{ color: "var(--ok)" }}>
                    {formatMoney(toMinor(data.summary.total_paid), currency)}
                  </strong>
                </div>

                <div className="statement-kpi-card">
                  <span className="payment-summary-label">Invoices / Orders</span>
                  <strong className="payment-summary-val">
                    {data.summary.orders_count} orders
                  </strong>
                  <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                    {data.summary.unpaid_orders} currently pending
                  </span>
                </div>
              </div>

              {/* Chronological Ledger Table */}
              <div className="customers-table-card" style={{ border: "1px solid var(--line)" }}>
                <div className="customers-table-wrap">
                  <table className="customers-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Transaction Details</th>
                        <th style={{ textAlign: "right" }}>Charged</th>
                        <th style={{ textAlign: "right" }}>Paid</th>
                        <th style={{ textAlign: "right" }}>Running Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => {
                        running += e.charge - e.credit;
                        return (
                          <tr key={e.key}>
                            <td style={{ fontSize: "0.82rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                              {e.at ? new Date(e.at).toLocaleDateString() : "—"}
                            </td>
                            <td>
                              <span style={{ fontWeight: 650, color: "var(--text-strong)" }}>
                                {e.description}
                              </span>
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 700 }}>
                              {e.charge > 0 ? formatMoney(e.charge, currency) : "—"}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 700, color: "var(--ok)" }}>
                              {e.credit !== 0 ? formatMoney(e.credit, currency) : "—"}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 800 }}>
                              <span style={{ color: running > 0 ? "var(--danger)" : "var(--text-strong)" }}>
                                {formatMoney(running, currency)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {entries.length === 0 && (
                  <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
                    No recorded sales or payments on this account yet.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="customer-modal-footer">
          <button
            type="button"
            className="customers-export-btn"
            onClick={handleExportPdf}
            disabled={entries.length === 0}
          >
            <Printer size={15} />
            <span>Print / Save PDF</span>
          </button>
          <button type="button" className="customers-add-btn" onClick={onClose}>
            Close Statement
          </button>
        </div>
      </div>
    </div>
  );
}
