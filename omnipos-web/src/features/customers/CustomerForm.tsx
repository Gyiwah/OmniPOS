import { useState } from "react";

import type { LocalCustomer } from "@/db/schema";
import { saveCustomer } from "./service";

type Props = {
  storeId: string;
  customer?: LocalCustomer;
  onClose: () => void;
  onSaved: (customer: LocalCustomer) => void;
};

/**
 * Register or edit a customer.
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
    setBusy(true);
    setError(null);

    try {
      onSaved(await saveCustomer(storeId, { name, phone: phone || null, email: email || null }, customer));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the customer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={customer ? "Edit customer" : "Add customer"}>
      <form className="modal" onSubmit={submit}>
        <h2>{customer ? "Edit customer" : "Add customer"}</h2>

        <label htmlFor="c-name">Name</label>
        <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />

        <label htmlFor="c-phone">Phone</label>
        <input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />

        <label htmlFor="c-email">Email</label>
        <input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />

        {customer && Number(customer.outstanding_balance) > 0 && (
          <p className="conflict-hint">
            Owes {customer.outstanding_balance}. Balances are settled by taking a payment, not by editing this record.
          </p>
        )}

        {error && <p className="notice notice-error" role="status">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="link" onClick={onClose}>Cancel</button>
          <button type="submit" className="pay-button" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
