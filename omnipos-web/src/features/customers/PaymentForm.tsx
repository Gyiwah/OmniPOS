import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Banknote,
  CreditCard,
  ArrowUpRight,
  Smartphone,
  X,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  Coins,
  ShieldCheck,
} from "lucide-react";

import { db, type LocalCustomer, type LocalOrder } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useCurrentShift } from "@/features/shifts/useCurrentShift";
import { takePayment } from "./service";

const METHODS = ["cash", "card", "transfer", "mobile_money"] as const;

type PaymentMethod = (typeof METHODS)[number];

const METHOD_DETAILS: Record<
  PaymentMethod,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  cash: { label: "Cash Tender", icon: Banknote },
  card: { label: "Card Terminal", icon: CreditCard },
  transfer: { label: "Bank Transfer", icon: ArrowUpRight },
  mobile_money: { label: "Mobile Money", icon: Smartphone },
};

type Props = {
  storeId: string;
  currency: string;
  customer: LocalCustomer;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Take payment against a customer's store credit account.
 *
 * The unpaid sales are listed so the money can be put against a specific invoice.
 * Naming an invoice settles it as well as the account, which lets a shop
 * answer "which of these have I paid for?" — a general balance alone cannot.
 */
export function PaymentForm({ storeId, currency, customer, onClose, onSaved }: Props) {
  const owed = toMinor(customer.outstanding_balance);
  const shift = useCurrentShift();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
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
    if (entered <= 0) {
      setError("Please enter a payment amount greater than zero.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await takePayment({
        storeId,
        customer,
        amountMinor: entered,
        method,
        orderId: orderId || null,
        reference: reference.trim() || null,
        registerShiftId: shift?.id ?? null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  };

  const handlePayFull = () => {
    setAmount((owed / 100).toFixed(2));
    setError(null);
  };

  return (
    <div
      className="customer-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Debt settlement for ${customer.name}`}
    >
      <form className="customer-modal-box" onSubmit={submit}>
        <div className="customer-modal-header">
          <h2 className="customer-modal-title">
            <Coins size={18} />
            <span>Settle Customer Debt</span>
          </h2>
          <button
            type="button"
            className="customers-clear-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        <div className="customer-modal-body">
          {/* Customer Metadata Banner */}
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
              <strong style={{ fontSize: "0.95rem", color: "var(--text-strong)" }}>
                {customer.name}
              </strong>
              {customer.phone && (
                <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{customer.phone}</div>
              )}
            </div>
            <span className="customers-status-pill arrears">
              <AlertTriangle size={12} />
              <span>Owes {formatMoney(owed, currency)}</span>
            </span>
          </div>

          {/* Real-time Settlement Bento */}
          <div className="payment-summary-bento">
            <div className="payment-summary-cell">
              <span className="payment-summary-label">Current Debt</span>
              <span className="payment-summary-val" style={{ color: "var(--danger)" }}>
                {formatMoney(owed, currency)}
              </span>
            </div>
            <div className="payment-summary-cell">
              <span className="payment-summary-label">Paying Now</span>
              <span className="payment-summary-val" style={{ color: "var(--accent)" }}>
                {formatMoney(entered, currency)}
              </span>
            </div>
            <div className="payment-summary-cell">
              <span className="payment-summary-label">Remaining Debt</span>
              <span
                className="payment-summary-val"
                style={{ color: remaining === 0 ? "var(--ok)" : "var(--text-strong)" }}
              >
                {formatMoney(remaining, currency)}
              </span>
            </div>
          </div>

          {/* Amount Input with Quick Full Pay Action */}
          <div className="customer-field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label htmlFor="pay-amount">Amount Received ({currency}) *</label>
              <button
                type="button"
                className="returns-quick-btn"
                onClick={handlePayFull}
                style={{ padding: "0.2rem 0.65rem", fontSize: "0.75rem" }}
              >
                <ShieldCheck size={13} />
                <span>Pay In Full ({formatMoney(owed, currency)})</span>
              </button>
            </div>
            <input
              id="pay-amount"
              className="customer-input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
              }}
              placeholder="0.00"
              autoFocus
            />
          </div>

          {/* Tender Method Selection */}
          <div className="customer-field">
            <label>Payment Tender Method *</label>
            <div className="payment-methods-grid" role="radiogroup" aria-label="Tender Method">
              {METHODS.map((m) => {
                const item = METHOD_DETAILS[m];
                const Icon = item.icon;
                const active = method === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`payment-method-card ${active ? "active" : ""}`}
                    onClick={() => setMethod(m)}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Invoice Allocation (if unpaid sales exist) */}
          {unpaid.length > 0 && (
            <div className="customer-field">
              <label htmlFor="pay-order">Invoice Allocation</label>
              <select
                id="pay-order"
                className="customer-input"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
              >
                <option value="">Apply generally to customer account</option>
                {unpaid.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.order_number} — {formatMoney(toMinor(o.total) - toMinor(o.amount_paid), currency)} balance
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Reference / Notes */}
          <div className="customer-field">
            <label htmlFor="pay-ref">Transaction Reference (Optional)</label>
            <input
              id="pay-ref"
              className="customer-input"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. MoMo Transaction ID, Bank Cheque #..."
            />
          </div>

          {/* Shift Cash Warning / Confirmation */}
          {method === "cash" && shift && (
            <div
              className="returns-auth-notice ok"
              style={{ fontSize: "0.78rem", padding: "0.6rem 0.85rem", margin: 0 }}
            >
              <CheckCircle2 size={15} />
              <span>
                Cash payment will automatically post to active register <strong>Shift #{shift.id.slice(0, 6)}</strong> drawer reconciliation.
              </span>
            </div>
          )}

          {entered > 0 && remaining === 0 && (
            <div
              className="returns-auth-notice ok"
              style={{ fontSize: "0.78rem", padding: "0.6rem 0.85rem", margin: 0 }}
            >
              <CheckCircle2 size={15} />
              <span>This payment will settle this customer’s outstanding debt in full.</span>
            </div>
          )}

          {error && (
            <p className="notice notice-error" role="status" style={{ margin: 0 }}>
              {error}
            </p>
          )}
        </div>

        <div className="customer-modal-footer">
          <button type="button" className="customers-export-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="customers-add-btn"
            style={{ background: "var(--cta)" }}
            disabled={busy || entered <= 0}
          >
            {busy ? (
              <>Processing…</>
            ) : (
              <>
                <Receipt size={16} />
                <span>Confirm Payment {entered > 0 ? formatMoney(entered, currency) : ""}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
