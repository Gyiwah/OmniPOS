import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Printer,
  Smartphone,
  Search,
  X,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  Plus,
  Minus,
  RotateCcw,
  Boxes,
  DollarSign,
  Layers,
  Sparkles,
  ShieldAlert,
  Coins,
} from "lucide-react";

import { api } from "@/api/client";
import { db, type LocalReturn } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useCurrentShift } from "@/features/shifts/useCurrentShift";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { printTableAsPdf } from "@/utils/printTable";
import { lookupOrder, processReturn, type ReturnLookup } from "./service";
import { canRefund, maxCashRefund, refundTotal, type ReturnDraftLine } from "./returns";
import {
  defaultRefundMethod,
  matchRefundMethod,
  REFUND_METHODS,
  REFUND_METHOD_LABELS,
  refundMethodLabel,
  type RefundMethod,
} from "./refundMethod";

import "./returns.css";

const REFUND_METHOD_ICONS = {
  cash: Banknote,
  card: CreditCard,
  transfer: ArrowUpRight,
  mobile_money: Smartphone,
} as const;

const COMMON_REASONS = [
  "Defective / Damaged",
  "Wrong Item / Size",
  "Customer Changed Mind",
  "Expired Stock",
  "Billing Adjustment",
];

type RemoteReturn = {
  id: string;
  order_id: string;
  order_number: string | null;
  reason: string;
  amount: string;
  refund_method: string;
  client_created_at: string | null;
  created_at: string | null;
  items: Array<{
    id: string;
    product_name: string;
    unit_price: string;
    quantity: number;
    line_total: string;
  }>;
};

type ReturnDetail = Pick<RemoteReturn, "items">;

/**
 * OmniPOS Returns & Refunds Workstation
 *
 * Professional UI/UX with real-time cashier drawer reconciliation,
 * safe eligibility validation, flexible restock controls, and an
 * executive audit ledger.
 */
export function ReturnsPage() {
  const storeId = useSession((s) => s.storeId);
  const store = useSession((s) => s.store);
  const currency = store?.currency ?? "GHS";
  const shift = useCurrentShift();

  const [reference, setReference] = useState("");
  const [lookup, setLookup] = useState<ReturnLookup | null>(null);
  const [draft, setDraft] = useState<ReturnDraftLine[]>([]);
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<RefundMethod>("cash");
  const [notice, setNotice] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyMethod, setHistoryMethod] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expandedReturnId, setExpandedReturnId] = useState<string | null>(null);

  const localReturns = useLiveQuery(
    async () => {
      if (!storeId) return [];
      const rows = await db.returns.where("store_id").equals(storeId).toArray();
      return rows.sort((a, b) => b.client_created_at.localeCompare(a.client_created_at));
    },
    [storeId],
    [] as LocalReturn[],
  );

  const remoteReturns = useQuery({
    queryKey: ["returns", storeId],
    enabled: Boolean(storeId),
    queryFn: async () => {
      const all: RemoteReturn[] = [];
      let page = 1;
      let lastPage = 1;
      do {
        const result = await api.get<{
          data: RemoteReturn[];
          meta?: { last_page?: number };
        }>("/api/returns", { per_page: 200, page });
        all.push(...(result.data ?? []));
        lastPage = result.meta?.last_page ?? page;
        page += 1;
      } while (page <= lastPage);
      return all;
    },
  });

  const localReturnById = useMemo(
    () => new Map(localReturns.map((record) => [record.id, record])),
    [localReturns],
  );

  const allReturns = useMemo(() => {
    const merged = new Map<string, RemoteReturn | LocalReturn>();
    for (const record of remoteReturns.data ?? []) merged.set(record.id, record);
    for (const record of localReturns) merged.set(record.id, record);

    const needle = historySearch.trim().toLowerCase();
    const fromDate = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toDate = to ? new Date(`${to}T23:59:59.999`).getTime() : null;

    return [...merged.values()]
      .filter((record) => {
        const createdAt = "_state" in record
          ? record.client_created_at
          : record.client_created_at ?? record.created_at ?? "";
        const method = "refund_method" in record ? record.refund_method : "";
        const orderNumber = "order_number" in record ? record.order_number ?? "" : "";
        const date = Date.parse(createdAt);
        if (historyMethod !== "all" && method !== historyMethod) return false;
        if (fromDate !== null && date < fromDate) return false;
        if (toDate !== null && date > toDate) return false;
        if (!needle) return true;
        return [record.id, orderNumber, record.reason, record.amount]
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        const aDate = ("_state" in a ? a.client_created_at : a.client_created_at ?? a.created_at) ?? "";
        const bDate = ("_state" in b ? b.client_created_at : b.client_created_at ?? b.created_at) ?? "";
        return bDate.localeCompare(aDate);
      });
  }, [from, historyMethod, historySearch, localReturns, remoteReturns.data, to]);

  // Executive KPI summary calculations
  const kpis = useMemo(() => {
    let totalRefundMinor = 0;
    let totalItems = 0;
    let cashCount = 0;
    let digitalCount = 0;

    for (const ret of allReturns) {
      totalRefundMinor += toMinor(ret.amount);
      const lines = "items" in ret ? ret.items : [];
      totalItems += lines.reduce((acc, item) => acc + item.quantity, 0);

      const m = "refund_method" in ret ? ret.refund_method : "cash";
      if (m === "cash") {
        cashCount++;
      } else {
        digitalCount++;
      }
    }

    return {
      totalReturnsCount: allReturns.length,
      totalRefundMinor,
      totalItems,
      cashCount,
      digitalCount,
    };
  }, [allReturns]);

  const expandedReturn = allReturns.find((record) => record.id === expandedReturnId);
  const detailQuery = useQuery({
    queryKey: ["return-detail", storeId, expandedReturnId],
    enabled: Boolean(expandedReturnId && expandedReturn && !localReturnById.has(expandedReturnId)),
    queryFn: async () => {
      const result = await api.get<{ data: ReturnDetail }>(`/api/returns/${expandedReturnId}`);
      return result.data;
    },
  });

  const total = lookup ? refundTotal(lookup.lines, draft) : 0;
  const paidCap = lookup ? maxCashRefund(lookup.order) : 0;

  const onSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!storeId || !reference.trim()) return;

    setBusy(true);
    setNotice(null);
    try {
      const found = await lookupOrder(storeId, reference.trim());
      if (!found) {
        setLookup(null);
        setNotice({ kind: "warn", text: `No sale found for "${reference.trim()}". Check receipt number.` });
        return;
      }
      setLookup(found);
      setDraft(found.lines.map((l) => ({ orderItemId: l.orderItemId, quantity: 0, restock: true })));
      setReason("");
      setRefundMethod(defaultRefundMethod(found.order.payment_method));
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Lookup failed." });
    } finally {
      setBusy(false);
    }
  };

  const onRefund = async () => {
    if (!storeId || !lookup) return;

    const verdict = canRefund(lookup.lines, draft, reason);
    if (!verdict.ok) {
      setNotice({ kind: "error", text: verdict.reason });
      return;
    }

    setBusy(true);
    try {
      const record = await processReturn({
        storeId,
        order: lookup.order,
        lines: lookup.lines,
        draft,
        reason,
        refundMethod,
        registerShiftId: shift?.id ?? null,
      });

      setNotice({
        kind: "ok",
        text:
          `Refund of ${formatMoney(toMinor(record.amount), currency)} successfully recorded for ${record.order_number}.` +
          (lookup.authoritative
            ? ""
            : " (Recorded on till records; server will reconcile on sync)."),
      });

      setLookup(null);
      setDraft([]);
      setReference("");
      setRefundMethod("cash");
      void useSync.getState().sync(storeId);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not record the return." });
    } finally {
      setBusy(false);
    }
  };

  const setLine = (orderItemId: string, patch: Partial<ReturnDraftLine>) => {
    setDraft((lines) => lines.map((l) => (l.orderItemId === orderItemId ? { ...l, ...patch } : l)));
    setNotice(null);
  };

  const handleReturnAll = () => {
    if (!lookup) return;
    setDraft((lines) =>
      lines.map((d) => {
        const line = lookup.lines.find((l) => l.orderItemId === d.orderItemId);
        return {
          ...d,
          quantity: line ? line.quantityEligible : 0,
        };
      })
    );
  };

  const handleResetSelection = () => {
    setDraft((lines) => lines.map((d) => ({ ...d, quantity: 0 })));
  };

  const salePaidBy = lookup ? matchRefundMethod(lookup.order.payment_method) : null;

  return (
    <div className="returns-root">
      {/* --- Topbar Header --- */}
      <header className="returns-topbar">
        <div className="returns-title-block">
          <h1 className="returns-main-title">
            <ArrowLeftRight size={26} aria-hidden="true" />
            <span>Returns & Refunds Workstation</span>
          </h1>
          <div className="returns-subtitle-row">
            <span>{store?.name ?? "OmniPOS Store"}</span>
            <span>·</span>
            <span>Customer returns, inventory restocking & drawer reconciliation</span>
          </div>
        </div>

        <div className="returns-top-controls">
          {shift ? (
            <div className="returns-shift-badge active">
              <span className="returns-pulse-dot" />
              <span>Shift #{shift.id.slice(0, 6)} Active</span>
            </div>
          ) : (
            <div className="returns-shift-badge inactive">
              <AlertTriangle size={14} />
              <span>No Active Drawer Shift</span>
            </div>
          )}

          <button
            type="button"
            className="returns-export-btn"
            onClick={() =>
              printTableAsPdf({
                title: "Returns & Refunds Ledger",
                columns: ["Receipt", "Date & Time", "Items", "Reason", "Refund Method", "Refunded", "Status"],
                rows: allReturns.map((record) => {
                  const date =
                    "_state" in record
                      ? record.client_created_at
                      : record.client_created_at ?? record.created_at ?? "";
                  const lines = "items" in record ? record.items : [];
                  const orderNumber = "order_number" in record ? record.order_number ?? "" : "";
                  const method = "refund_method" in record ? record.refund_method : "cash";
                  const recordStatus =
                    "_state" in record
                      ? record._state === "pending"
                        ? "Queued"
                        : record._state === "conflict"
                          ? "Rejected"
                          : record._state === "discarded"
                            ? "Discarded"
                            : "Synced"
                      : "Synced";
                  return [
                    orderNumber || record.id.slice(0, 8),
                    date ? new Date(date).toLocaleString() : "—",
                    String(lines.reduce((sum, item) => sum + item.quantity, 0)),
                    record.reason,
                    refundMethodLabel(method),
                    formatMoney(toMinor(record.amount), currency),
                    recordStatus,
                  ];
                }),
              })
            }
          >
            <Printer size={15} aria-hidden="true" />
            <span>Print Ledger</span>
          </button>
        </div>
      </header>

      {/* --- Executive KPI Bento Grid (4 Cards) --- */}
      <section className="returns-kpi-bento" aria-label="Returns Overview Metrics">
        <div className="returns-kpi-card">
          <div className="returns-kpi-top">
            <span className="returns-kpi-label">Returns Handled</span>
            <div className="returns-kpi-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              <RotateCcw size={18} />
            </div>
          </div>
          <div className="returns-kpi-val">{kpis.totalReturnsCount}</div>
          <span className="returns-kpi-hint">Total refund tickets recorded</span>
        </div>

        <div className="returns-kpi-card">
          <div className="returns-kpi-top">
            <span className="returns-kpi-label">Total Refund Value</span>
            <div className="returns-kpi-icon" style={{ background: "var(--cta-soft)", color: "var(--cta)" }}>
              <DollarSign size={18} />
            </div>
          </div>
          <div className="returns-kpi-val">{formatMoney(kpis.totalRefundMinor, currency)}</div>
          <span className="returns-kpi-hint">Refund payouts & adjustments</span>
        </div>

        <div className="returns-kpi-card">
          <div className="returns-kpi-top">
            <span className="returns-kpi-label">Items Returned</span>
            <div className="returns-kpi-icon" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}>
              <Boxes size={18} />
            </div>
          </div>
          <div className="returns-kpi-val">{kpis.totalItems}</div>
          <span className="returns-kpi-hint">Units processed through counter</span>
        </div>

        <div className="returns-kpi-card">
          <div className="returns-kpi-top">
            <span className="returns-kpi-label">Settlement Mix</span>
            <div className="returns-kpi-icon" style={{ background: "var(--panel-2)", color: "var(--text-strong)" }}>
              <Layers size={18} />
            </div>
          </div>
          <div className="returns-kpi-val">
            {kpis.cashCount} <span style={{ fontSize: "1rem", fontWeight: 600, color: "var(--muted)" }}>Cash</span> / {kpis.digitalCount} <span style={{ fontSize: "1rem", fontWeight: 600, color: "var(--muted)" }}>Digital</span>
          </div>
          <span className="returns-kpi-hint">Cash vs cashless refund channels</span>
        </div>
      </section>

      {/* --- Search & Barcode Lookup Section --- */}
      <section className="returns-search-card">
        <div className="returns-search-header">
          <div className="returns-search-title">
            <Receipt size={18} />
            <span>Lookup Sale by Receipt or Order Number</span>
          </div>
          <span className="returns-hero-meta">Scan receipt barcode or enter order number</span>
        </div>

        <form className="returns-search-form" onSubmit={onSearch}>
          <div className="returns-search-input-wrap">
            <Search size={18} />
            <input
              className="returns-search-input"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. OM-20260901-0007 or scan barcode..."
              aria-label="Receipt number"
              autoFocus
            />
            {reference && (
              <button
                type="button"
                className="returns-input-clear-btn"
                onClick={() => setReference("")}
                aria-label="Clear search input"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="returns-find-btn"
            disabled={busy || !reference.trim()}
          >
            {busy ? (
              <>Looking up…</>
            ) : (
              <>
                <Search size={16} />
                <span>Find Sale</span>
              </>
            )}
          </button>
        </form>

        {notice && (
          <div className={`returns-auth-notice ${notice.kind === "ok" ? "ok" : "warn"}`} role="status">
            {notice.kind === "ok" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <span>{notice.text}</span>
          </div>
        )}

        {/* Informative Guidance Card when Idle */}
        {!lookup && (
          <div className="returns-idle-guide">
            <div className="returns-guide-item">
              <div className="returns-guide-icon">
                <Receipt size={16} />
              </div>
              <div className="returns-guide-text">
                <strong>Barcode & Receipt Matching</strong>
                <p>Supports full receipts from any terminal in this store, offline or online.</p>
              </div>
            </div>
            <div className="returns-guide-item">
              <div className="returns-guide-icon">
                <Boxes size={16} />
              </div>
              <div className="returns-guide-text">
                <strong>Smart Restock Controls</strong>
                <p>Return items back to store stock or discard damaged items safely without inflating counts.</p>
              </div>
            </div>
            <div className="returns-guide-item">
              <div className="returns-guide-icon">
                <Coins size={16} />
              </div>
              <div className="returns-guide-text">
                <strong>Drawer Reconciliation</strong>
                <p>Tracks cash drawer balances in real time so your end-of-shift audits stay 100% accurate.</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* --- Return Workstation Panel (Active Sale Lookup) --- */}
      {lookup && (
        <section className="returns-workstation" aria-label="Return Workstation">
          {/* Order Summary Hero Banner */}
          <div className="returns-order-hero">
            <div className="returns-order-hero-left">
              <div className="returns-order-num-row">
                <span className="returns-order-num-badge">{lookup.order.order_number}</span>
                {lookup.authoritative ? (
                  <span className="returns-shift-badge active" title="Server verified">
                    <CheckCircle2 size={13} />
                    <span>Server Verified</span>
                  </span>
                ) : (
                  <span className="returns-shift-badge inactive" title="Till local copy">
                    <AlertTriangle size={13} />
                    <span>Till Local Records</span>
                  </span>
                )}
              </div>
              <div className="returns-hero-meta">
                <span>{new Date(lookup.order.client_created_at).toLocaleString()}</span>
                <span>·</span>
                <span>{lookup.order.customer_name ? `Customer: ${lookup.order.customer_name}` : "Walk-in Customer"}</span>
                <span>·</span>
                <span>Original Method: <strong>{lookup.order.payment_method.toUpperCase()}</strong></span>
              </div>
            </div>

            <div className="returns-order-hero-right">
              <div className="returns-hero-stat">
                <span className="returns-hero-stat-label">Original Sale Total</span>
                <span className="returns-hero-stat-val">
                  {formatMoney(toMinor(lookup.order.total), currency)}
                </span>
              </div>
              <div className="returns-hero-actions">
                <button
                  type="button"
                  className="returns-quick-btn"
                  onClick={handleReturnAll}
                  title="Mark all eligible quantities for return"
                >
                  <Sparkles size={14} />
                  <span>Return All Items</span>
                </button>
                <button
                  type="button"
                  className="returns-quick-btn"
                  onClick={handleResetSelection}
                  title="Clear returning quantities"
                >
                  <RotateCcw size={14} />
                  <span>Reset</span>
                </button>
              </div>
            </div>
          </div>

          {!lookup.authoritative && (
            <div className="returns-auth-notice warn">
              <ShieldAlert size={18} />
              <span>
                <strong>Local Till Check:</strong> Working from this register’s own database. If this customer already returned items on another till before sync, the server will enforce final eligibility upon reconnection.
              </span>
            </div>
          )}

          {/* Item Return Lines Table */}
          <div className="returns-table-card">
            <div className="returns-table-wrap">
              <table className="returns-table">
                <thead>
                  <tr>
                    <th>Product / Item</th>
                    <th style={{ textAlign: "center" }}>Sold</th>
                    <th style={{ textAlign: "center" }}>Returned Prior</th>
                    <th style={{ textAlign: "center" }}>Eligible</th>
                    <th style={{ textAlign: "center" }}>Return Quantity</th>
                    <th>Inventory Restock</th>
                    <th style={{ textAlign: "right" }}>Refund Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lookup.lines.map((line) => {
                    const entry = draft.find((d) => d.orderItemId === line.orderItemId);
                    const quantity = entry?.quantity ?? 0;
                    const isExhausted = line.quantityEligible === 0;

                    return (
                      <tr
                        key={line.orderItemId}
                        className={isExhausted ? "returns-row-disabled" : undefined}
                      >
                        <td>
                          <span className="returns-item-title">{line.name}</span>
                          <span className="returns-item-sku">
                            {formatMoney(line.unitPrice, currency)} / unit
                          </span>
                        </td>
                        <td style={{ textAlign: "center", fontWeight: 700 }}>{line.quantitySold}</td>
                        <td style={{ textAlign: "center", color: "var(--muted)" }}>
                          {line.quantityReturned || "—"}
                        </td>
                        <td style={{ textAlign: "center", fontWeight: 800, color: isExhausted ? "var(--muted)" : "var(--ok)" }}>
                          {line.quantityEligible}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <div className="returns-stepper">
                            <button
                              type="button"
                              className="returns-stepper-btn"
                              disabled={isExhausted || quantity <= 0}
                              onClick={() =>
                                setLine(line.orderItemId, { quantity: Math.max(0, quantity - 1) })
                              }
                              aria-label={`Decrease return count for ${line.name}`}
                            >
                              <Minus size={13} />
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={line.quantityEligible}
                              value={quantity}
                              disabled={isExhausted}
                              aria-label={`Quantity returning of ${line.name}`}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const clamped = Math.min(line.quantityEligible, Math.max(0, isNaN(val) ? 0 : val));
                                setLine(line.orderItemId, { quantity: clamped });
                              }}
                              className="returns-stepper-input"
                            />
                            <button
                              type="button"
                              className="returns-stepper-btn"
                              disabled={isExhausted || quantity >= line.quantityEligible}
                              onClick={() =>
                                setLine(line.orderItemId, {
                                  quantity: Math.min(line.quantityEligible, quantity + 1),
                                })
                              }
                              aria-label={`Increase return count for ${line.name}`}
                            >
                              <Plus size={13} />
                            </button>
                          </div>
                        </td>
                        <td>
                          <label className="returns-restock-toggle">
                            <input
                              type="checkbox"
                              style={{ display: "none" }}
                              checked={entry?.restock ?? true}
                              disabled={isExhausted}
                              onChange={(e) => setLine(line.orderItemId, { restock: e.target.checked })}
                            />
                            <div className={`returns-restock-track ${(entry?.restock ?? true) ? "checked" : ""}`}>
                              <div className="returns-restock-thumb" />
                            </div>
                            <span className={`returns-restock-label ${(entry?.restock ?? true) ? "on" : "off"}`}>
                              {(entry?.restock ?? true) ? "Back to shelf" : "Damaged / Discard"}
                            </span>
                          </label>
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 800, fontSize: "0.95rem" }}>
                          {quantity > 0 ? formatMoney(line.unitPrice * quantity, currency) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Settlement Details & Reason Card */}
          <div className="returns-settlement-grid">
            {/* Reason Section with Quick Tags */}
            <div className="returns-settlement-card">
              <h3 className="returns-settlement-title">
                <Receipt size={16} />
                <span>Return Reason & Notes</span>
              </h3>
              <div className="returns-reason-tags">
                {COMMON_REASONS.map((r) => {
                  const isSelected = reason === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      className={`returns-reason-chip ${isSelected ? "selected" : ""}`}
                      onClick={() => setReason(r)}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
              <input
                id="return-reason"
                className="returns-reason-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Provide details (e.g. faulty seal, customer changed mind)..."
                aria-label="Return reason details"
              />
            </div>

            {/* Refund Tender Method Selection */}
            <div className="returns-settlement-card">
              <h3 className="returns-settlement-title">
                <Coins size={16} />
                <span>Refund Settlement Tender</span>
              </h3>
              <div className="returns-methods-group" role="radiogroup" aria-label="Refund Method">
                {REFUND_METHODS.map((m) => {
                  const Icon = REFUND_METHOD_ICONS[m];
                  const active = refundMethod === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`returns-method-card ${active ? "active" : ""}`}
                      onClick={() => setRefundMethod(m)}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span>{REFUND_METHOD_LABELS[m]}</span>
                    </button>
                  );
                })}
              </div>

              <div
                className={`returns-tender-match-pill ${salePaidBy === refundMethod ? "match" : "diff"}`}
              >
                {salePaidBy === null ? (
                  <>Original sale had non-standard tender — please verify with cashier.</>
                ) : salePaidBy === refundMethod ? (
                  <>
                    <CheckCircle2 size={15} />
                    <span>Matches original sale tender (drawer cash reconciled accurately).</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={15} />
                    <span>Different from original tender — drawer balance will adjust for this method.</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Credit Sale Over-refund Alert */}
          {total > paidCap && (
            <div className="returns-auth-notice warn">
              <AlertTriangle size={18} />
              <span>
                <strong>Credit Cap Notice:</strong> This sale only received {formatMoney(paidCap, currency)} in cash/deposit (the balance was credit). Refunding {formatMoney(total, currency)} exceeds cash received for this sale.
              </span>
            </div>
          )}

          {/* Workstation Action Footer */}
          <div className="returns-workstation-footer">
            <div className="returns-footer-summary">
              <span className="returns-footer-label">Total Refund Due:</span>
              <span className="returns-footer-total">{formatMoney(total, currency)}</span>
            </div>

            <div className="returns-footer-cta-group">
              <button
                type="button"
                className="returns-cancel-btn"
                onClick={() => {
                  setLookup(null);
                  setDraft([]);
                  setNotice(null);
                }}
              >
                Cancel Workstation
              </button>
              <button
                type="button"
                className="returns-submit-btn"
                disabled={busy || total <= 0}
                onClick={onRefund}
              >
                {busy ? (
                  <>Recording Return…</>
                ) : (
                  <>
                    <RotateCcw size={18} />
                    <span>Process Refund {formatMoney(total, currency)}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* --- Return History Ledger Section --- */}
      <section className="returns-history-card">
        <div className="returns-history-head">
          <div className="returns-history-title-wrap">
            <h2 className="returns-history-title">Return & Refund History</h2>
            <span className="returns-count-badge">{allReturns.length} records</span>
          </div>

          <span className="returns-hero-meta">
            Real-time audit log of all completed returns and payouts
          </span>
        </div>

        {/* Filter Toolbar */}
        <div className="returns-filter-toolbar" role="search">
          <input
            className="returns-history-search-input"
            aria-label="Search returns"
            placeholder="Search by receipt, reason, or amount..."
            value={historySearch}
            onChange={(event) => setHistorySearch(event.target.value)}
          />

          <select
            className="returns-history-select"
            aria-label="Filter returns by refund method"
            value={historyMethod}
            onChange={(event) => setHistoryMethod(event.target.value)}
          >
            <option value="all">All Tender Methods</option>
            {REFUND_METHODS.map((method) => (
              <option key={method} value={method}>
                {REFUND_METHOD_LABELS[method]}
              </option>
            ))}
          </select>

          <div className="returns-date-group">
            <span>From:</span>
            <input
              className="returns-date-input"
              aria-label="Returns from date"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>

          <div className="returns-date-group">
            <span>To:</span>
            <input
              className="returns-date-input"
              aria-label="Returns to date"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>

          {(historySearch || historyMethod !== "all" || from || to) && (
            <button
              type="button"
              className="returns-quick-btn"
              onClick={() => {
                setHistorySearch("");
                setHistoryMethod("all");
                setFrom("");
                setTo("");
              }}
            >
              <X size={14} />
              <span>Clear Filters</span>
            </button>
          )}
        </div>

        {remoteReturns.isError && (
          <div className="returns-auth-notice warn" style={{ margin: "1rem" }}>
            <AlertTriangle size={18} />
            <span>Could not reach remote cloud server. Displaying local returns saved on this register.</span>
          </div>
        )}

        {/* Returns Table */}
        <div className="returns-table-wrap">
          <table className="returns-table">
            <thead>
              <tr>
                <th style={{ width: "3.5rem" }}></th>
                <th>Receipt / Order</th>
                <th>Timestamp</th>
                <th style={{ textAlign: "center" }}>Items</th>
                <th>Reason</th>
                <th>Tender</th>
                <th style={{ textAlign: "right" }}>Refunded</th>
                <th style={{ textAlign: "center" }}>Sync Status</th>
              </tr>
            </thead>
            <tbody>
              {allReturns.map((record) => {
                const localRecord = localReturnById.get(record.id);
                const date =
                  "_state" in record
                    ? record.client_created_at
                    : record.client_created_at ?? record.created_at ?? "";
                const lines =
                  localRecord?.items ??
                  (expandedReturnId === record.id ? detailQuery.data?.items : undefined);
                const orderNumber = "order_number" in record ? record.order_number : "";
                const method = "refund_method" in record ? record.refund_method : "cash";
                const itemCount =
                  lines?.reduce((sum, item) => sum + item.quantity, 0) ??
                  ("items" in record ? record.items.reduce((sum, item) => sum + item.quantity, 0) : 0);
                const isExpanded = expandedReturnId === record.id;

                return (
                  <Fragment key={record.id}>
                    <tr>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className="returns-input-clear-btn"
                          aria-expanded={isExpanded}
                          onClick={() => setExpandedReturnId(isExpanded ? null : record.id)}
                          title="Toggle line item breakdown"
                        >
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </td>
                      <td>
                        <span
                          className="returns-item-title"
                          style={{
                            fontFamily: "ui-monospace, monospace",
                            cursor: "pointer",
                          }}
                          onClick={() => setExpandedReturnId(isExpanded ? null : record.id)}
                        >
                          {orderNumber || record.id.slice(0, 8)}
                        </span>
                      </td>
                      <td style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                        {date ? new Date(date).toLocaleString() : "—"}
                      </td>
                      <td style={{ textAlign: "center", fontWeight: 700 }}>{itemCount}</td>
                      <td style={{ maxWidth: "16rem", whiteSpace: "normal" }}>
                        <span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{record.reason}</span>
                      </td>
                      <td>
                        <span className="returns-shift-badge active" style={{ fontSize: "0.75rem" }}>
                          {refundMethodLabel(method)}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 800, fontSize: "0.95rem" }}>
                        {formatMoney(toMinor(record.amount), currency)}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {"_state" in record && record._state === "pending" && (
                          <span className="returns-shift-badge inactive">Queued</span>
                        )}
                        {(!("_state" in record) || record._state === "clean") && (
                          <span className="returns-shift-badge active">Synced</span>
                        )}
                        {"_state" in record && record._state === "conflict" && (
                          <span className="returns-shift-badge inactive" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
                            Rejected
                          </span>
                        )}
                        {"_state" in record && record._state === "discarded" && (
                          <span className="returns-shift-badge inactive">Discarded</span>
                        )}
                      </td>
                    </tr>

                    {/* Expandable nested table for itemized return details */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ padding: "0.5rem 1rem", background: "var(--panel-2)" }}>
                          <div className="returns-expanded-box">
                            {detailQuery.isLoading && !localRecord && (
                              <span className="returns-hero-meta">Loading itemized return details…</span>
                            )}
                            {detailQuery.isError && !localRecord && (
                              <span className="returns-hero-meta" style={{ color: "var(--danger)" }}>
                                Could not load item details.
                              </span>
                            )}
                            {lines && lines.length > 0 ? (
                              <table className="returns-nested-table">
                                <thead>
                                  <tr>
                                    <th>Returned Item</th>
                                    <th style={{ textAlign: "center" }}>Quantity</th>
                                    <th style={{ textAlign: "right" }}>Unit Price</th>
                                    <th style={{ textAlign: "right" }}>Line Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lines.map((item) => (
                                    <tr key={item.id}>
                                      <td style={{ fontWeight: 700 }}>{item.product_name}</td>
                                      <td style={{ textAlign: "center", fontWeight: 700 }}>{item.quantity}</td>
                                      <td style={{ textAlign: "right", color: "var(--muted)" }}>
                                        {formatMoney(toMinor(item.unit_price), currency)}
                                      </td>
                                      <td style={{ textAlign: "right", fontWeight: 800 }}>
                                        {formatMoney(toMinor(item.line_total), currency)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : null}
                            {lines && lines.length === 0 && (
                              <span className="returns-hero-meta">No item details recorded.</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {allReturns.length === 0 && (
          <div className="returns-empty-ledger">
            <div className="returns-empty-icon">
              <RotateCcw size={28} />
            </div>
            <strong>No returns recorded</strong>
            <p style={{ margin: 0, fontSize: "0.85rem", maxWidth: "24rem" }}>
              {remoteReturns.isLoading
                ? "Loading returns ledger from server..."
                : "No customer returns match the active filter criteria. Enter a receipt number above to initiate a refund."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
