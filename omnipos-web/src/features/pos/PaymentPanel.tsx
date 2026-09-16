import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type LocalCustomer } from "@/db/schema";
import {
  balanceDue,
  canComplete,
  changeDue,
  formatMoney,
  tenderedTotal,
  toMinor,
  type CartLine,
  type TenderLine,
} from "./cart";

type Props = {
  total: number;
  lines: CartLine[];
  currency: string;
  tenders: TenderLine[];
  methods: string[];
  customer: { id: string; name: string; phone: string | null } | null;
  storeId: string;
  busy: boolean;
  onTendersChange: (tenders: TenderLine[]) => void;
  onCustomerChange: (customer: { id: string; name: string; phone: string | null } | null) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  transfer: "Transfer",
  mobile_money: "Mobile money",
};

/**
 * Payment, including split tender.
 *
 * Multiple tenders are the normal case, not an edge case — part cash, part
 * mobile money is routine. Each is its own row, which is what the payments table
 * on the server expects and what makes a drawer reconcile: only the cash portion
 * should ever be expected in the till.
 */
export function PaymentPanel({
  total,
  lines,
  currency,
  tenders,
  methods,
  customer,
  storeId,
  busy,
  onTendersChange,
  onCustomerChange,
  onCancel,
  onConfirm,
}: Props) {
  const [entry, setEntry] = useState("");
  const [method, setMethod] = useState(methods[0] ?? "cash");
  const [customerQuery, setCustomerQuery] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => { amountRef.current?.focus(); }, []);

  const outstanding = useMemo(() => balanceDue(total, tenders), [total, tenders]);
  const change = useMemo(() => changeDue(total, tenders), [total, tenders]);
  const verdict = canComplete(total, tenders, customer !== null, lines);

  const matches = useLiveQuery(
    async () => {
      const needle = customerQuery.trim().toLowerCase();
      if (needle.length < 2) return [];
      const rows = await db.customers.where("store_id").equals(storeId).toArray();
      return rows.filter((c) => c.search_key.includes(needle)).slice(0, 6);
    },
    [customerQuery, storeId],
    [] as LocalCustomer[],
  );

  const addTender = (amountMinor: number) => {
    if (amountMinor <= 0) return;
    onTendersChange([...tenders, { method, amount: amountMinor }]);
    setEntry("");
    amountRef.current?.focus();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Take payment">
      <div className="modal payment-panel">
        <header>
          <h2>Take payment</h2>
          <p className="payment-due">
            {outstanding > 0
              ? <>Due <strong>{formatMoney(outstanding, currency)}</strong> of {formatMoney(total, currency)}</>
              : <>Tendered <strong>{formatMoney(tenderedTotal(tenders), currency)}</strong></>}
          </p>
        </header>

        <div className="tender-methods">
          {methods.map((m) => (
            <button
              key={m}
              type="button"
              className={m === method ? "chip chip-active" : "chip"}
              onClick={() => setMethod(m)}
            >
              {METHOD_LABELS[m] ?? m}
            </button>
          ))}
        </div>

        <form
          className="tender-entry"
          onSubmit={(e) => { e.preventDefault(); addTender(toMinor(entry)); }}
        >
          <input
            ref={amountRef}
            inputMode="decimal"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            placeholder="0.00"
            aria-label="Amount tendered"
          />
          <button type="submit">Add {METHOD_LABELS[method] ?? method}</button>
          {outstanding > 0 && (
            <button type="button" className="link" onClick={() => addTender(outstanding)}>
              Exact ({formatMoney(outstanding, currency)})
            </button>
          )}
        </form>

        {tenders.length > 0 && (
          <ul className="tender-list">
            {tenders.map((t, i) => (
              <li key={`${t.method}-${i}`}>
                <span>{METHOD_LABELS[t.method] ?? t.method}</span>
                <span>{formatMoney(t.amount, currency)}</span>
                <button
                  type="button"
                  className="link danger"
                  onClick={() => onTendersChange(tenders.filter((_, idx) => idx !== i))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {change > 0 && (
          <p className="change-due">Change due <strong>{formatMoney(change, currency)}</strong></p>
        )}

        <section className="customer-attach">
          <label htmlFor="cust">Customer {outstanding > 0 && <em>(required to leave a balance)</em>}</label>
          {customer ? (
            <p className="customer-selected">
              {customer.name}
              <button type="button" className="link" onClick={() => onCustomerChange(null)}>Change</button>
            </p>
          ) : (
            <>
              <input
                id="cust"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder="Search by name or phone"
              />
              {matches.length > 0 && (
                <ul className="customer-matches">
                  {matches.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onCustomerChange({ id: c.id, name: c.name, phone: c.phone });
                          setCustomerQuery("");
                        }}
                      >
                        {c.name}
                        {c.phone && <span className="muted"> · {c.phone}</span>}
                        {Number(c.outstanding_balance) > 0 && (
                          <span className="debt"> owes {formatMoney(toMinor(c.outstanding_balance), currency)}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {!verdict.ok && <p className="notice notice-error" role="status">{verdict.reason}</p>}

        <footer className="modal-actions">
          <button type="button" className="link" onClick={onCancel}>Cancel</button>
          <button type="button" className="pay-button" disabled={!verdict.ok || busy} onClick={onConfirm}>
            {busy ? "Completing…" : "Complete sale"}
          </button>
        </footer>
      </div>
    </div>
  );
}
