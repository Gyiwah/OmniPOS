import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type LocalCustomer, type LocalOrder } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useCurrentShift } from "@/features/shifts/useCurrentShift";
import { takePayment } from "./service";

const METHODS = ["cash", "card", "transfer", "mobile_money"];

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  transfer: "Transfer",
  mobile_money: "Mobile money",
};

type Props = {
  storeId: string;
  currency: string;
  customer: LocalCustomer;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Take money against a customer's account.
 *
 * The unpaid sales are listed so the money can be put against one of them.
 * Naming an invoice settles it as well as the account, which is what lets a shop
 * answer "which of these have I paid for?" — a balance alone cannot.
 */
export function PaymentForm({ storeId, currency, customer, onClose, onSaved }: Props) {
  const owed = toMinor(customer.outstanding_balance);
  const shift = useCurrentShift();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [orderId, setOrderId] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unpaid = useLiveQuery(
    async () => {
      const rows = await db.orders.where("store_id").equals(storeId).toArray();
      return rows
        .filter((o) => o.customer_id === customer.id && toMinor(o.total) > toMinor(o.amount_paid))
        .sort((a, b) => a.client_created_at.localeCompare(b.client_created_at));
    },
    [storeId, customer.id],
    [] as LocalOrder[],
  );

  const entered = toMinor(amount);
  const remaining = Math.max(0, owed - entered);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await takePayment({
        storeId,
        customer,
        amountMinor: entered,
        method,
        orderId: orderId || null,
        reference: reference || null,
        registerShiftId: shift?.id ?? null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Take payment on account">
      <form className="modal" onSubmit={submit}>
        <h2>Payment from {customer.name}</h2>
        <p className="payment-due">
          Owes <strong>{formatMoney(owed, currency)}</strong>
        </p>

        <label htmlFor="pay-amount">Amount ({currency})</label>
        <input
          id="pay-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          autoFocus
        />
        <button type="button" className="link" onClick={() => setAmount((owed / 100).toFixed(2))}>
          Pay it all off ({formatMoney(owed, currency)})
        </button>

        <div className="tender-methods">
          {METHODS.map((m) => (
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

        {unpaid.length > 0 && (
          <>
            <label htmlFor="pay-order">Against a sale</label>
            <select id="pay-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">The account generally</option>
              {unpaid.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.order_number} — {formatMoney(toMinor(o.total) - toMinor(o.amount_paid), currency)} outstanding
                </option>
              ))}
            </select>
          </>
        )}

        <label htmlFor="pay-ref">Reference</label>
        <input
          id="pay-ref"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Transfer reference, cheque number…"
        />

        {entered > 0 && entered <= owed && (
          <p className="notice notice-ok">
            {remaining === 0
              ? "Settles the account in full."
              : `Leaves ${formatMoney(remaining, currency)} outstanding.`}
          </p>
        )}

        {!shift && method === "cash" && (
          <p className="notice notice-warn">
            No drawer open, so this cash will not be counted in any reconciliation.
          </p>
        )}

        {error && <p className="notice notice-error" role="status">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="link" onClick={onClose}>Cancel</button>
          <button type="submit" className="pay-button" disabled={busy || entered <= 0}>
            {busy ? "Recording…" : `Take ${formatMoney(entered, currency)}`}
          </button>
        </div>
      </form>
    </div>
  );
}
