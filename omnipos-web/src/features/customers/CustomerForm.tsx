import { useState } from "react";
import { UserPlus, Edit2, X, AlertTriangle, Check } from "lucide-react";

import type { LocalCustomer } from "@/db/schema";
import { saveCustomer } from "./service";

type Props = {
  storeId: string;
  customer?: LocalCustomer;
  onClose: () => void;
  onSaved: (customer: LocalCustomer) => void;
};

/**
 * Register or edit a customer profile.
 *
 * What they have spent and what they owe are not editable. The server derives
 * both from orders and payments and rejects a client's figures — a till that
 * synced late would otherwise reinstate a debt the customer already settled
 * somewhere else.
 */
export function CustomerForm({ storeId, customer, onClose, onSaved }: Props) {
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    setBusy(true);
    setError(null);

    try {
      onSaved(
        await saveCustomer(
          storeId,
          { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null },
          customer,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the customer.");
    } finally {
      setBusy(false);
    }
  };

  const hasDebt = customer && Number(customer.outstanding_balance) > 0;

  return (
    <div
      className="customer-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={customer ? "Edit customer profile" : "Register new customer"}
    >
      <form className="customer-modal-box" onSubmit={submit}>
        <div className="customer-modal-header">
          <h2 className="customer-modal-title">
            {customer ? <Edit2 size={18} /> : <UserPlus size={18} />}
            <span>{customer ? "Edit Customer Profile" : "Register New Customer"}</span>
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
          <div className="customer-field">
            <label htmlFor="c-name">Full Name *</label>
            <input
              id="c-name"
              className="customer-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ama Mensah or Golden Spoon Bistro"
              autoFocus
              required
            />
          </div>

          <div className="customer-field">
            <label htmlFor="c-phone">Phone Number</label>
            <input
              id="c-phone"
              className="customer-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. +233 24 123 4567"
            />
          </div>

          <div className="customer-field">
            <label htmlFor="c-email">Email Address</label>
            <input
              id="c-email"
              type="email"
              className="customer-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. customer@example.com (optional)"
            />
          </div>

          {hasDebt && (
            <div
              className="notice notice-warn"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.5rem",
                fontSize: "0.82rem",
                margin: 0,
              }}
            >
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
              <span>
                This account currently owes <strong>GHS {customer.outstanding_balance}</strong>.
                Account balances are adjusted automatically by taking a debt settlement payment, not by editing profile fields.
              </span>
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
            disabled={busy || !name.trim()}
          >
            {busy ? (
              <>Saving…</>
            ) : (
              <>
                <Check size={16} />
                <span>{customer ? "Save Changes" : "Create Profile"}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
