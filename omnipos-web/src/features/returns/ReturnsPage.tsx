import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeftRight } from "lucide-react";

import { db, type LocalReturn } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useCurrentShift } from "@/features/shifts/useCurrentShift";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { lookupOrder, processReturn, type ReturnLookup } from "./service";
import { canRefund, maxCashRefund, refundTotal, type ReturnDraftLine } from "./returns";

const REFUND_METHODS = ["cash", "card", "transfer", "mobile_money"];

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
  const [refundMethod, setRefundMethod] = useState("cash");
  const [notice, setNotice] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const recent = useLiveQuery(
    async () => {
      if (!storeId) return [];
      const rows = await db.returns.where("store_id").equals(storeId).toArray();
      return rows.sort((a, b) => b.client_created_at.localeCompare(a.client_created_at)).slice(0, 25);
    },
    [storeId],
    [] as LocalReturn[],
  );

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

            <label htmlFor="refund-method">Refund by</label>
            <select id="refund-method" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
              {REFUND_METHODS.map((m) => (
                <option key={m} value={m}>{m.replace("_", " ")}</option>
              ))}
            </select>
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
            <button type="button" className="pay-button" disabled={busy || total <= 0} onClick={onRefund}>
              {busy ? "Recording…" : `Refund ${formatMoney(total, currency)}`}
            </button>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h2>Recent returns on this till</h2>
          <table className="table">
            <thead>
              <tr><th>Receipt</th><th>When</th><th>Items</th><th>Reason</th><th>Refunded</th><th /></tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.order_number}</td>
                  <td>{new Date(r.client_created_at).toLocaleString()}</td>
                  <td>{r.items.reduce((sum, i) => sum + i.quantity, 0)}</td>
                  <td>{r.reason}</td>
                  <td>{formatMoney(toMinor(r.amount), currency)}</td>
                  <td>
                    {r._state === "pending" && <span className="pill pill-pending">Queued</span>}
                    {r._state === "clean" && <span className="pill pill-online">Synced</span>}
                    {r._state === "conflict" && <span className="pill pill-offline">Rejected</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
