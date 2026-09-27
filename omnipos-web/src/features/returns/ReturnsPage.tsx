import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeftRight, ArrowUpRight, Banknote, ChevronDown, ChevronRight, CreditCard, Printer, Smartphone } from "lucide-react";

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

const REFUND_METHOD_ICONS = {
  cash: Banknote,
  card: CreditCard,
  transfer: ArrowUpRight,
  mobile_money: Smartphone,
} as const;

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
 * Taking goods back over the counter.
 *
 * The refund is written locally and queued, like a sale. What it cannot do
 * locally is decide eligibility with certainty: this till only knows the refunds
 * it processed itself, and two terminals refunding the same items is exactly how
 * a shop pays out twice for one sale. So the figures come from the server when
 * there is a connection, and the screen says plainly when they do not.
 */
export function ReturnsPage() {
  const storeId = useSession((s) => s.storeId);
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
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
    if (!storeId) return;

    setBusy(true);
    setNotice(null);
    try {
      const found = await lookupOrder(storeId, reference);
      if (!found) {
        setLookup(null);
        setNotice({ kind: "warn", text: `No sale found for "${reference.trim()}".` });
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
          `Refunded ${formatMoney(toMinor(record.amount), currency)} against ${record.order_number}.` +
          (lookup.authoritative
            ? ""
            : " Eligibility was checked against this till only; the server will confirm it on sync."),
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

  const salePaidBy = lookup ? matchRefundMethod(lookup.order.payment_method) : null;

  return (
    <div className="page">
      <header className="page-header">
        <h1><ArrowLeftRight size={20} aria-hidden="true" /> Returns</h1>
        {!shift && (
          <p className="muted">No drawer open — a cash refund will not be counted against a shift.</p>
        )}
      </header>

      <form className="page-actions" onSubmit={onSearch}>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Receipt number, e.g. OM-20260901-0007"
          aria-label="Receipt number"
          autoFocus
        />
        <button type="submit" className="secondary-button" disabled={busy || !reference.trim()}>
          {busy ? "Looking…" : "Find sale"}
        </button>
      </form>

      {notice && <p className={`notice notice-${notice.kind}`} role="status">{notice.text}</p>}

      {lookup && (
        <section className="return-panel">
          <header className="conflict-head">
            <div>
              <h2>{lookup.order.order_number}</h2>
              <p className="muted">
                {new Date(lookup.order.client_created_at).toLocaleString()}
                {lookup.order.customer_name ? ` · ${lookup.order.customer_name}` : " · Walk-in"}
              </p>
            </div>
            <div className="conflict-amount">{formatMoney(toMinor(lookup.order.total), currency)}</div>
          </header>

          {!lookup.authoritative && (
            <p className="notice notice-warn">
              Working from this till's own records. Refunds processed at another terminal are not counted here, so the
              server may still reject this — it re-checks against every return ever recorded.
            </p>
          )}

          <table className="table">
            <thead>
              <tr><th>Item</th><th>Sold</th><th>Already back</th><th>Can return</th><th>Returning</th><th>Restock</th><th>Refund</th></tr>
            </thead>
            <tbody>
              {lookup.lines.map((line) => {
                const entry = draft.find((d) => d.orderItemId === line.orderItemId);
                const quantity = entry?.quantity ?? 0;

                return (
                  <tr key={line.orderItemId} className={line.quantityEligible === 0 ? "row-muted" : undefined}>
                    <td>{line.name}</td>
                    <td>{line.quantitySold}</td>
                    <td>{line.quantityReturned || "—"}</td>
                    <td>{line.quantityEligible}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={line.quantityEligible}
                        value={quantity}
                        disabled={line.quantityEligible === 0}
                        aria-label={`Quantity returning of ${line.name}`}
                        onChange={(e) => setLine(line.orderItemId, { quantity: Math.max(0, Number(e.target.value)) })}
                        className="qty-input"
                      />
                    </td>
                    <td>
                      {/*
                        Damaged goods come back to the shop but not to the
                        shelf. Restocking them would put stock on the system
                        that nobody can sell.
                      */}
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={entry?.restock ?? true}
                          disabled={line.quantityEligible === 0}
                          onChange={(e) => setLine(line.orderItemId, { restock: e.target.checked })}
                        />
                        Back to shelf
                      </label>
                    </td>
                    <td>{quantity > 0 ? formatMoney(line.unitPrice * quantity, currency) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="return-actions">
            <label htmlFor="return-reason">Reason</label>
            <input
              id="return-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Faulty, wrong size, changed their mind…"
            />

            <div className="refund-method-block">
              <span id="refund-method-label">Refund by</span>
              <div className="refund-methods" role="radiogroup" aria-labelledby="refund-method-label">
                {REFUND_METHODS.map((m) => {
                  const Icon = REFUND_METHOD_ICONS[m];
                  const active = refundMethod === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={active ? "chip chip-active" : "chip"}
                      onClick={() => setRefundMethod(m)}
                    >
                      <Icon size={16} aria-hidden="true" />
                      {REFUND_METHOD_LABELS[m]}
                    </button>
                  );
                })}
              </div>
              <p className="muted method-hint">
                {salePaidBy === null
                  ? "This sale did not record a method the till can refund on — check the receipt."
                  : salePaidBy === refundMethod
                    ? "Matches how this sale was paid."
                    : "Different from how this sale was paid — the drawer is reconciled on this choice."}
              </p>
            </div>
          </div>

          {total > paidCap && (
            <p className="notice notice-warn">
              This sale was only paid {formatMoney(paidCap, currency)} — the rest was left on the customer's account.
              Refunding {formatMoney(total, currency)} hands back more cash than the shop took.
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="link" onClick={() => { setLookup(null); setDraft([]); }}>
              Cancel
            </button>
            <button type="button" className="pay-button pay-button-cta" disabled={busy || total <= 0} onClick={onRefund}>
              {busy ? "Recording…" : `Refund ${formatMoney(total, currency)}`}
            </button>
          </div>
        </section>
      )}

      <section>
        <h2>Return history</h2>
        <div className="page-actions" role="search">
          <button type="button" className="secondary-button" onClick={() => printTableAsPdf({
            title: "Returns & Refunds",
            columns: ["Receipt", "When", "Items", "Reason", "Refund method", "Refunded", "Status"],
            rows: allReturns.map((record) => {
              const date = "_state" in record
                ? record.client_created_at
                : record.client_created_at ?? record.created_at ?? "";
              const lines = "items" in record ? record.items : [];
              const orderNumber = "order_number" in record ? record.order_number ?? "" : "";
              const method = "refund_method" in record ? record.refund_method : "cash";
              const recordStatus = "_state" in record
                ? record._state === "pending" ? "Queued" : record._state === "conflict" ? "Rejected" : record._state === "discarded" ? "Discarded" : "Synced"
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
          })}>
            <Printer size={16} aria-hidden="true" /> Print / Save PDF
          </button>
          <input aria-label="Search returns" placeholder="Receipt, reason, refund amount" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} />
          <select aria-label="Filter returns by refund method" value={historyMethod} onChange={(event) => setHistoryMethod(event.target.value)}>
            <option value="all">All refund methods</option>
            {REFUND_METHODS.map((method) => <option key={method} value={method}>{REFUND_METHOD_LABELS[method]}</option>)}
          </select>
          <label className="muted">From <input aria-label="Returns from date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="muted">To <input aria-label="Returns to date" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </div>

        {remoteReturns.isError && <p className="notice notice-warn">Could not reach the server. Showing returns saved on this device.</p>}
        <div className="table-scroll">
        <section>
          <table className="table">
            <thead>
              <tr><th>Return</th><th>When</th><th>Items</th><th>Reason</th><th>By</th><th>Refunded</th><th>Status</th></tr>
            </thead>
            <tbody>
              {allReturns.map((record) => {
                const localRecord = localReturnById.get(record.id);
                const date = "_state" in record
                  ? record.client_created_at
                  : record.client_created_at ?? record.created_at ?? "";
                const lines = localRecord?.items ?? (expandedReturnId === record.id ? detailQuery.data?.items : undefined);
                const orderNumber = "order_number" in record ? record.order_number : "";
                const method = "refund_method" in record ? record.refund_method : "cash";
                const itemCount = lines?.reduce((sum, item) => sum + item.quantity, 0)
                  ?? ("items" in record ? record.items.reduce((sum, item) => sum + item.quantity, 0) : 0);
                return (
                  <Fragment key={record.id}>
                    <tr>
                      <td><button type="button" className="link" aria-expanded={expandedReturnId === record.id} onClick={() => setExpandedReturnId(expandedReturnId === record.id ? null : record.id)}>
                        {expandedReturnId === record.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />} <span className="mono">{orderNumber || record.id.slice(0, 8)}</span>
                      </button></td>
                      <td>{date ? new Date(date).toLocaleString() : "—"}</td>
                      <td>{itemCount}</td>
                      <td>{record.reason}</td>
                      <td>{refundMethodLabel(method)}</td>
                      <td>{formatMoney(toMinor(record.amount), currency)}</td>
                      <td>
                        {"_state" in record && record._state === "pending" && <span className="pill pill-pending">Queued</span>}
                        {(!("_state" in record) || record._state === "clean") && <span className="pill pill-online">Synced</span>}
                        {"_state" in record && record._state === "conflict" && <span className="pill pill-offline">Rejected</span>}
                        {"_state" in record && record._state === "discarded" && <span className="pill pill-discarded">Discarded</span>}
                      </td>
                    </tr>
                    {expandedReturnId === record.id && (
                      <tr>
                        <td colSpan={7}>
                          {detailQuery.isLoading && !localRecord && <span className="muted">Loading returned items…</span>}
                          {detailQuery.isError && !localRecord && <span className="danger-text">Could not load return details.</span>}
                          {lines?.length ? <table className="table"><thead><tr><th>Item</th><th>Quantity</th><th>Unit amount</th><th>Refunded</th></tr></thead><tbody>
                            {lines.map((item) => <tr key={item.id}><td>{item.product_name}</td><td>{item.quantity}</td><td>{formatMoney(toMinor(item.unit_price), currency)}</td><td>{formatMoney(toMinor(item.line_total), currency)}</td></tr>)}
                          </tbody></table> : null}
                          {lines && lines.length === 0 && <span className="muted">No item details recorded.</span>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
        </div>
        {allReturns.length === 0 && <p className="muted">{remoteReturns.isLoading ? "Loading returns…" : "No returns match these filters."}</p>}
      </section>
    </div>
  );
}
