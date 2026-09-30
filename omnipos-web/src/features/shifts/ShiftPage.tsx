import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Banknote,
  Printer,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  Coins,
  ShieldCheck,
  Receipt,
  Layers,
  Lock,
  Unlock,
  TrendingUp,
} from "lucide-react";

import { db, type LocalShift } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { printTableAsPdf } from "@/utils/printTable";
import { closeShift, openShift, recordCashMovement, shiftActivity } from "./service";
import { buildZReport } from "./shift";
import { useCurrentShift } from "./useCurrentShift";

import "./shifts.css";

const QUICK_FLOAT_PRESETS = [50, 100, 200, 500];

const COMMON_EXPENSE_REASONS = [
  "Bread / Bakery Stock",
  "Vegetables / Fresh Produce",
  "Courier / Delivery Fee",
  "Cleaning Supplies",
  "Float Top-up",
  "Safe / Bank Drop",
];

/**
 * OmniPOS Cash Drawer & Register Shift Control Center
 *
 * Professional offline-first cash management suite with real-time
 * float tracking, drawer reconciliation, and end-of-day Z-Report balancing.
 */
export function ShiftPage() {
  const storeId = useSession((s) => s.storeId);
  const store = useSession((s) => s.store);
  const user = useSession((s) => s.user);
  const currency = store?.currency ?? "GHS";

  const shift = useCurrentShift();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const history = useLiveQuery(
    async () => {
      if (!storeId) return [];
      const rows = await db.shifts.where("store_id").equals(storeId).toArray();
      return rows
        .filter((s) => s.status === "closed")
        .sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""))
        .slice(0, 30);
    },
    [storeId],
    [] as LocalShift[],
  );

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (storeId) void useSync.getState().sync(storeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  if (!storeId || !user) {
    return (
      <div className="drawer-root">
        <p className="muted">Please log in and select a store first.</p>
      </div>
    );
  }

  return (
    <div className="drawer-root">
      {/* --- Topbar Header --- */}
      <header className="drawer-topbar">
        <div className="drawer-title-block">
          <h1 className="drawer-main-title">
            <Banknote size={26} aria-hidden="true" />
            <span>Register Drawer & Shifts</span>
          </h1>
          <div className="drawer-subtitle-row">
            <span>{store?.name ?? "OmniPOS Store"}</span>
            <span>·</span>
            <span>Cash drawer balancing, float reconciliation & shift audit ledger</span>
            <span>·</span>
            <span className="dashboard-currency-tag" title="Store operating currency">
              Currency: <strong>{currency}</strong>
            </span>
          </div>
        </div>

        <div className="drawer-top-controls">
          {shift ? (
            <div className="drawer-status-badge open">
              <span className="drawer-pulse-dot" />
              <span>Shift #{shift.id.slice(0, 6)} Open · {shift.cashier_name}</span>
            </div>
          ) : (
            <div className="drawer-status-badge closed">
              <Lock size={14} />
              <span>Terminal Drawer Closed</span>
            </div>
          )}

          {history.length > 0 && (
            <button
              type="button"
              className="customers-export-btn"
              onClick={() =>
                printTableAsPdf({
                  title: "Register Shifts & Cash Drawer Audit Ledger",
                  columns: ["Cashier", "Opened", "Closed", "Counted Cash", "Expected Cash", "Variance", "Status"],
                  rows: history.map((s) => {
                    const counted = s.actual_cash === null ? null : toMinor(s.actual_cash);
                    const expected = s.expected_cash === null ? null : toMinor(s.expected_cash);
                    const variance = counted !== null && expected !== null ? counted - expected : null;
                    return [
                      s.cashier_name,
                      new Date(s.opened_at).toLocaleString(),
                      s.closed_at ? new Date(s.closed_at).toLocaleString() : "—",
                      counted === null ? "—" : formatMoney(counted, currency),
                      expected === null ? "Awaiting sync" : formatMoney(expected, currency),
                      variance === null ? "—" : formatMoney(variance, currency),
                      s._state === "pending" ? "Queued" : s._state === "conflict" ? "Rejected" : "Synced",
                    ];
                  }),
                })
              }
            >
              <Printer size={15} aria-hidden="true" />
              <span>Export History PDF</span>
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="returns-auth-notice warn" role="status">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* --- Main Workstation Body --- */}
      {shift ? (
        <OpenDrawer
          shift={shift}
          storeId={storeId}
          currency={currency}
          busy={busy}
          onCashMovement={(direction, amount, reason) =>
            run(() => recordCashMovement({ storeId, shiftId: shift.id, direction, amount, reason }))
          }
          onClose={(countedCash, notes) =>
            run(() => closeShift({ storeId, shiftId: shift.id, countedCash, notes }))
          }
        />
      ) : (
        <OpenDrawerForm
          currency={currency}
          cashierName={user.name}
          busy={busy}
          onOpen={(openingFloat) =>
            run(() =>
              openShift({
                storeId,
                cashierUserId: user.id,
                cashierName: user.name,
                openingFloat,
              }),
            )
          }
        />
      )}

      {/* --- Historical Closed Drawers Ledger --- */}
      {history.length > 0 && (
        <section className="drawer-history-card">
          <div className="drawer-history-head">
            <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
              <h2 style={{ fontSize: "1.15rem", fontWeight: 800, margin: 0, color: "var(--text-strong)" }}>
                Closed Drawer Audit Ledger
              </h2>
              <span className="returns-count-badge">{history.length} shifts</span>
            </div>
            <span style={{ fontSize: "0.82rem", color: "var(--muted)", fontWeight: 550 }}>
              Immutable shift balancing logs & end-of-day counts
            </span>
          </div>

          <div className="customers-table-wrap">
            <table className="customers-table">
              <thead>
                <tr>
                  <th>Cashier</th>
                  <th>Shift Opened</th>
                  <th>Shift Closed</th>
                  <th style={{ textAlign: "right" }}>Counted Cash</th>
                  <th style={{ textAlign: "right" }}>Expected Cash</th>
                  <th style={{ textAlign: "right" }}>Variance</th>
                  <th style={{ textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((s) => {
                  const counted = s.actual_cash === null ? null : toMinor(s.actual_cash);
                  const expected = s.expected_cash === null ? null : toMinor(s.expected_cash);
                  const variance = counted !== null && expected !== null ? counted - expected : null;

                  return (
                    <tr key={s.id}>
                      <td>
                        <strong style={{ color: "var(--text-strong)" }}>{s.cashier_name}</strong>
                      </td>
                      <td style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                        {new Date(s.opened_at).toLocaleString()}
                      </td>
                      <td style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                        {s.closed_at ? new Date(s.closed_at).toLocaleString() : "—"}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>
                        {counted === null ? "—" : formatMoney(counted, currency)}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>
                        {expected === null ? (
                          <span className="muted" style={{ fontStyle: "italic" }}>awaiting sync</span>
                        ) : (
                          formatMoney(expected, currency)
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {variance === null ? (
                          <span className="muted">—</span>
                        ) : variance === 0 ? (
                          <span className="customers-status-pill settled">Balanced</span>
                        ) : variance > 0 ? (
                          <span className="customers-status-pill settled" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                            +{formatMoney(variance, currency)}
                          </span>
                        ) : (
                          <span className="customers-status-pill arrears">
                            {formatMoney(variance, currency)}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {s._state === "pending" && (
                          <span className="customers-status-pill queued">Queued</span>
                        )}
                        {(!("_state" in s) || s._state === "clean") && (
                          <span className="customers-status-pill settled">Synced</span>
                        )}
                        {s._state === "conflict" && (
                          <span className="customers-status-pill arrears">Rejected</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Workstation when register drawer is closed.
 */
function OpenDrawerForm({
  currency,
  cashierName,
  busy,
  onOpen,
}: {
  currency: string;
  cashierName: string;
  busy: boolean;
  onOpen: (openingFloat: number) => void;
}) {
  const [float, setFloat] = useState("");

  const handlePreset = (amount: number) => {
    setFloat(String(amount));
  };

  const handleReset = () => {
    setFloat("");
  };

  return (
    <form
      className="drawer-open-workstation"
      onSubmit={(e) => {
        e.preventDefault();
        onOpen(toMinor(float));
      }}
    >
      <div className="drawer-open-header">
        <div className="drawer-open-icon-bubble">
          <Unlock size={28} />
        </div>
        <h2 className="drawer-open-title">Open Terminal Register Drawer</h2>
        <p className="drawer-open-desc">
          Count your opening cash float before ringing up sales. This verified float serves as the baseline for all end-of-shift audits.
        </p>
      </div>

      <div
        style={{
          padding: "0.85rem 1rem",
          background: "var(--panel-2)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--line)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <span style={{ fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 700, color: "var(--muted)", display: "block" }}>
            Operating Cashier
          </span>
          <strong style={{ fontSize: "0.95rem", color: "var(--text-strong)" }}>{cashierName}</strong>
        </div>
        <span className="drawer-status-badge closed">Ready to Start</span>
      </div>

      {/* Opening Float Numeric Input */}
      <div className="drawer-float-input-box">
        <label htmlFor="float">Opening Cash Float ({currency}) *</label>
        <input
          id="float"
          className="drawer-big-input"
          inputMode="decimal"
          value={float}
          onChange={(e) => setFloat(e.target.value)}
          placeholder="0.00"
          autoFocus
        />
      </div>

      {/* Quick Denomination Presets */}
      <div className="drawer-presets-bar">
        {QUICK_FLOAT_PRESETS.map((amt) => (
          <button
            key={amt}
            type="button"
            className="drawer-preset-btn"
            onClick={() => handlePreset(amt)}
          >
            +{formatMoney(amt * 100, currency)}
          </button>
        ))}
        {float && (
          <button type="button" className="drawer-preset-btn" onClick={handleReset} style={{ color: "var(--muted)" }}>
            Clear
          </button>
        )}
      </div>

      <div
        className="returns-auth-notice ok"
        style={{ fontSize: "0.82rem", margin: 0 }}
      >
        <ShieldCheck size={16} />
        <span>
          Every subsequent cash sale, refund, and debt payment during this shift will automatically increment or decrement this float.
        </span>
      </div>

      <button
        type="submit"
        className="drawer-open-cta-btn"
        disabled={busy}
      >
        {busy ? (
          <>Opening Register…</>
        ) : (
          <>
            <Unlock size={18} />
            <span>Open Drawer & Begin Shift {float ? `(${formatMoney(toMinor(float), currency)})` : ""}</span>
          </>
        )}
      </button>
    </form>
  );
}

/**
 * Active Shift Workstation
 */
function OpenDrawer({
  shift,
  storeId,
  currency,
  busy,
  onCashMovement,
  onClose,
}: {
  shift: LocalShift;
  storeId: string;
  currency: string;
  busy: boolean;
  onCashMovement: (direction: "in" | "out", amount: number, reason: string) => void;
  onClose: (countedCash: number, notes: string | null) => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [closing, setClosing] = useState(false);

  const report = useLiveQuery(
    async () => {
      const { orders, refunds, settlements } = await shiftActivity(storeId, shift.id);
      return buildZReport(shift, orders, refunds, settlements);
    },
    [storeId, shift],
    null,
  );

  const countedMinor = toMinor(counted);
  const variance = report ? countedMinor - report.drawer.expected : 0;

  return (
    <>
      {/* --- Active Shift Executive KPI Bento Grid (4 Cards) --- */}
      <section className="drawer-kpi-bento" aria-label="Shift Key Metrics">
        <div className="drawer-kpi-card">
          <div className="drawer-kpi-top">
            <span className="drawer-kpi-label">Expected in Drawer</span>
            <div className="drawer-kpi-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              <Coins size={18} />
            </div>
          </div>
          <div className="drawer-kpi-val" style={{ color: "var(--accent)" }}>
            {report ? formatMoney(report.drawer.expected, currency) : "—"}
          </div>
          <span className="drawer-kpi-hint">Float + Cash sales − refunds & payouts</span>
        </div>

        <div className="drawer-kpi-card">
          <div className="drawer-kpi-top">
            <span className="drawer-kpi-label">Net Sales Takings</span>
            <div className="drawer-kpi-icon" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}>
              <Receipt size={18} />
            </div>
          </div>
          <div className="drawer-kpi-val">
            {report ? formatMoney(report.netSales, currency) : "—"}
          </div>
          <span className="drawer-kpi-hint">
            {report ? `${report.orderCount} sales · ${report.refundCount} refunds` : "Calculating takings..."}
          </span>
        </div>

        <div className="drawer-kpi-card">
          <div className="drawer-kpi-top">
            <span className="drawer-kpi-label">Opening Cash Float</span>
            <div className="drawer-kpi-icon" style={{ background: "var(--panel-2)", color: "var(--text-strong)" }}>
              <Banknote size={18} />
            </div>
          </div>
          <div className="drawer-kpi-val">
            {formatMoney(toMinor(shift.opening_float), currency)}
          </div>
          <span className="drawer-kpi-hint">Verified at {new Date(shift.opened_at).toLocaleTimeString()}</span>
        </div>

        <div className="drawer-kpi-card">
          <div className="drawer-kpi-top">
            <span className="drawer-kpi-label">Total Transactions</span>
            <div className="drawer-kpi-icon" style={{ background: "var(--cta-soft)", color: "var(--cta)" }}>
              <Layers size={18} />
            </div>
          </div>
          <div className="drawer-kpi-val">
            {report ? report.orderCount + report.refundCount + report.settlementCount : 0}
          </div>
          <span className="drawer-kpi-hint">Sales, returns and payments</span>
        </div>
      </section>

      {/* --- Two-Column Audit Grid --- */}
      <section className="drawer-content-grid">
        {/* Left Column: Cash Drawer Reconciliation Waterfall */}
        <div className="drawer-panel-card">
          <div className="drawer-card-header">
            <h2 className="drawer-card-title">
              <Coins size={18} />
              <span>Cash Drawer Audit Waterfall</span>
            </h2>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: 650 }}>
              Physical Cash in Till
            </span>
          </div>

          <div className="drawer-waterfall-list">
            <div className="drawer-waterfall-row">
              <span className="drawer-row-label">
                <span className="drawer-sign-tag drawer-sign-plus">+</span>
                <span>Opening Cash Float</span>
              </span>
              <span className="drawer-row-val">
                {formatMoney(toMinor(shift.opening_float), currency)}
              </span>
            </div>

            <div className="drawer-waterfall-row">
              <span className="drawer-row-label">
                <span className="drawer-sign-tag drawer-sign-plus">+</span>
                <span>Cash Sales Takings</span>
              </span>
              <span className="drawer-row-val" style={{ color: "var(--ok)" }}>
                {report ? formatMoney(report.drawer.cashSales, currency) : "—"}
              </span>
            </div>

            <div className="drawer-waterfall-row">
              <span className="drawer-row-label">
                <span className="drawer-sign-tag drawer-sign-plus">+</span>
                <span>Cash Debt Settlements</span>
              </span>
              <span className="drawer-row-val">
                {report ? formatMoney(report.drawer.cashSettlements, currency) : "—"}
              </span>
            </div>

            <div className="drawer-waterfall-row">
              <span className="drawer-row-label">
                <span className="drawer-sign-tag drawer-sign-plus">+</span>
                <span>Paid In (Float Top-up)</span>
              </span>
              <span className="drawer-row-val">
                {report ? formatMoney(report.drawer.paidIn, currency) : "—"}
              </span>
            </div>

            <div className="drawer-waterfall-row">
              <span className="drawer-row-label">
                <span className="drawer-sign-tag drawer-sign-minus">−</span>
                <span>Cash Refunds Payouts</span>
              </span>
              <span className="drawer-row-val" style={{ color: "var(--danger)" }}>
                {report ? formatMoney(report.drawer.cashRefunds, currency) : "—"}
              </span>
            </div>

            <div className="drawer-waterfall-row">
              <span className="drawer-row-label">
                <span className="drawer-sign-tag drawer-sign-minus">−</span>
                <span>Paid Out (Expenses / Drops)</span>
              </span>
              <span className="drawer-row-val" style={{ color: "var(--danger)" }}>
                {report ? formatMoney(report.drawer.paidOut, currency) : "—"}
              </span>
            </div>

            <div className="drawer-waterfall-total">
              <span className="drawer-total-label">Expected Physical Cash</span>
              <span className="drawer-total-val">
                {report ? formatMoney(report.drawer.expected, currency) : "—"}
              </span>
            </div>
          </div>

          <div
            className="returns-auth-notice ok"
            style={{ fontSize: "0.78rem", padding: "0.65rem 0.85rem", margin: 0 }}
          >
            <ShieldCheck size={15} />
            <span>
              Card, transfer, and mobile money payments are held digitally and excluded from the physical till drawer.
            </span>
          </div>
        </div>

        {/* Right Column: Shift Takings & Tender Mix */}
        <div className="drawer-panel-card">
          <div className="drawer-card-header">
            <h2 className="drawer-card-title">
              <Layers size={18} />
              <span>Shift Takings & Tender Mix</span>
            </h2>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: 650 }}>
              All Payment Channels
            </span>
          </div>

          {report && (
            <div className="drawer-waterfall-list">
              <div className="drawer-waterfall-row">
                <span className="drawer-row-label">Gross Sales Total ({report.orderCount} orders)</span>
                <span className="drawer-row-val">{formatMoney(report.grossSales, currency)}</span>
              </div>

              <div className="drawer-waterfall-row">
                <span className="drawer-row-label">Customer Refunds ({report.refundCount} items)</span>
                <span className="drawer-row-val" style={{ color: "var(--danger)" }}>
                  −{formatMoney(report.refundTotal, currency)}
                </span>
              </div>

              {report.settlementCount > 0 && (
                <div className="drawer-waterfall-row">
                  <span className="drawer-row-label">
                    Settled on Account ({report.settlementCount} payments)
                  </span>
                  <span className="drawer-row-val">
                    +{formatMoney(report.settlementTotal, currency)}
                  </span>
                </div>
              )}

              <div className="drawer-waterfall-total">
                <span className="drawer-total-label">Net Sales Takings</span>
                <span className="drawer-total-val" style={{ color: "var(--text-strong)" }}>
                  {formatMoney(report.netSales, currency)}
                </span>
              </div>

              {/* Tender Methods Breakdown */}
              {report.byMethod.length > 0 && (
                <div className="drawer-tender-list" style={{ marginTop: "0.5rem" }}>
                  {report.byMethod.map((m) => (
                    <div key={m.method} className="drawer-tender-item">
                      <div className="drawer-tender-top">
                        <span className="drawer-tender-name">
                          {m.method === "cash" ? <Banknote size={15} /> : <Receipt size={15} />}
                          <span>{m.method.replace("_", " ")}</span>
                        </span>
                        <span className="drawer-tender-amount">
                          {formatMoney(m.amount, currency)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* --- Cash Movements Station (Petty Cash / Paid In / Safe Drop) --- */}
      <section className="drawer-panel-card">
        <div className="drawer-card-header">
          <h2 className="drawer-card-title">
            <Coins size={18} />
            <span>Cash Movements (Paid In / Paid Out)</span>
          </h2>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            Log petty cash expenses or cash float additions
          </span>
        </div>

        {/* Quick Reason Chips */}
        <div className="returns-reason-tags">
          {COMMON_EXPENSE_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              className={`returns-reason-chip ${reason === r ? "selected" : ""}`}
              onClick={() => {
                setReason(r);
                if (r === "Float Top-up") setDirection("in");
                else setDirection("out");
              }}
            >
              {r}
            </button>
          ))}
        </div>

        <form
          className="drawer-movement-form"
          onSubmit={(e) => {
            e.preventDefault();
            onCashMovement(direction, toMinor(amount), reason);
            setAmount("");
            setReason("");
          }}
        >
          <div className="drawer-dir-toggle">
            <button
              type="button"
              className={`drawer-dir-btn ${direction === "out" ? "active-out" : ""}`}
              onClick={() => setDirection("out")}
            >
              <ArrowDownRight size={13} style={{ display: "inline", verticalAlign: "middle" }} /> Paid Out
            </button>
            <button
              type="button"
              className={`drawer-dir-btn ${direction === "in" ? "active-in" : ""}`}
              onClick={() => setDirection("in")}
            >
              <ArrowUpRight size={13} style={{ display: "inline", verticalAlign: "middle" }} /> Paid In
            </button>
          </div>

          <input
            className="drawer-movement-input"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount (0.00)"
            aria-label="Movement amount"
            required
          />

          <input
            className="drawer-movement-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (e.g. bread supplier, office pens)..."
            aria-label="Movement reason"
            required
          />

          <button
            type="submit"
            className="drawer-record-btn"
            disabled={busy || !amount || !reason.trim()}
          >
            {busy ? "Recording…" : "Record Movement"}
          </button>
        </form>

        {shift.movements.length > 0 && (
          <div className="customers-table-wrap" style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-sm)" }}>
            <table className="drawer-movement-table">
              <thead>
                <tr>
                  <th>Reason</th>
                  <th>Direction</th>
                  <th>Time</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {shift.movements.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 650 }}>{m.reason}</td>
                    <td>
                      <span className={`customers-status-pill ${m.direction === "in" ? "settled" : "arrears"}`}>
                        {m.direction === "in" ? "Paid In" : "Paid Out"}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                      {new Date(m.at).toLocaleTimeString()}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 750 }}>
                      {m.direction === "in" ? "+" : "−"}
                      {formatMoney(toMinor(m.amount), currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* --- Close Drawer & End-of-Shift Balancing Section --- */}
      <section className="drawer-close-card">
        <div className="drawer-card-header">
          <h2 className="drawer-card-title">
            <Lock size={18} />
            <span>End-of-Shift Drawer Balancing & Close</span>
          </h2>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            Z-Report physical cash verification
          </span>
        </div>

        {!closing ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
            <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)", maxWidth: "34rem" }}>
              Ready to close out register shift? Count all physical cash in the drawer and record your end-of-shift figures.
            </p>
            <button
              type="button"
              className="drawer-count-close-btn"
              onClick={() => setClosing(true)}
            >
              <Lock size={15} />
              <span>Count & Close Shift</span>
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onClose(countedMinor, notes.trim() || null);
            }}
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <div className="customer-field">
              <label htmlFor="counted">Physical Cash Counted ({currency}) *</label>
              <input
                id="counted"
                className="drawer-big-input"
                inputMode="decimal"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                placeholder="0.00"
                autoFocus
                required
              />
            </div>

            {counted !== "" && report && (
              <div
                className={`drawer-variance-alert ${
                  variance === 0 ? "balanced" : variance > 0 ? "over" : "short"
                }`}
                role="status"
              >
                {variance === 0 ? (
                  <>
                    <CheckCircle2 size={18} />
                    <span>Balances Exactly — Counted cash matches expected drawer balance perfectly.</span>
                  </>
                ) : variance > 0 ? (
                  <>
                    <TrendingUp size={18} />
                    <span>Drawer Surplus — Counted is over expected by {formatMoney(variance, currency)}.</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={18} />
                    <span>Drawer Shortage — Counted is short of expected by {formatMoney(-variance, currency)}.</span>
                  </>
                )}
              </div>
            )}

            <div className="customer-field">
              <label htmlFor="drawer-notes">Shift Closing Notes (Optional)</label>
              <input
                id="drawer-notes"
                className="customer-input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Discrepancy explanation or handover notes for manager..."
              />
            </div>

            <div
              className="returns-auth-notice ok"
              style={{ fontSize: "0.8rem", margin: 0 }}
            >
              <ShieldCheck size={15} />
              <span>
                Discrepancies are logged as an immutable audit record for managerial transparency and do not modify transaction ledger history.
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", paddingTop: "0.5rem" }}>
              <button
                type="button"
                className="customers-export-btn"
                onClick={() => setClosing(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="drawer-open-cta-btn"
                style={{ padding: "0 1.5rem", height: "2.75rem" }}
                disabled={busy || counted === ""}
              >
                {busy ? "Closing Drawer…" : "Confirm & Close Drawer"}
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
