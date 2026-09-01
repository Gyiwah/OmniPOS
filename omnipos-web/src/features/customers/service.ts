import { uuidv7 } from "@/core/uuidv7";
import { db, type LocalCustomer, type LocalPayment } from "@/db/schema";
import { toDecimal, toMinor } from "@/features/pos/cart";
import { enqueue } from "@/sync/engine";

/**
 * Registering and editing customers at the till.
 *
 * total_spend and outstanding_balance are never written here. The server derives
 * them from orders and payments and refuses a client's figure, because a
 * terminal that synced late would otherwise reinstate a debt the customer
 * already settled at another till. They are read-only cached numbers on this
 * side, refreshed by the changefeed.
 */

export type CustomerInput = {
  name: string;
  phone: string | null;
  email: string | null;
};

export async function saveCustomer(
  storeId: string,
  input: CustomerInput,
  existing?: LocalCustomer,
): Promise<LocalCustomer> {
  const name = input.name.trim();
  if (!name) throw new Error("A customer needs a name.");

  const phone = input.phone?.trim() ? input.phone.trim() : null;

  if (phone) {
    const clash = await db.customers
      .where("store_id")
      .equals(storeId)
      .filter((c) => c.phone === phone && c.id !== existing?.id)
      .first();

    if (clash) {
      // Not enforced by the server — a shop may legitimately have two accounts
      // on one household number. Warning here stops the far more common case:
      // the same customer being registered twice, so their debt is split across
      // two records and neither shows what they owe.
      throw new Error(`${phone} is already on "${clash.name}". Search for them instead of adding a second record.`);
    }
  }

  const customer: LocalCustomer = {
    id: existing?.id ?? uuidv7(),
    store_id: storeId,
    name,
    phone,
    email: input.email?.trim() ? input.email.trim() : null,
    total_spend: existing?.total_spend ?? "0.00",
    outstanding_balance: existing?.outstanding_balance ?? "0.00",
    updated_at: new Date().toISOString(),
    search_key: `${name} ${phone ?? ""}`.toLowerCase(),
    _state: "pending",
  };

  await db.transaction("rw", [db.customers, db.outbox], async () => {
    await db.customers.put(customer);
    await enqueue({
      storeId,
      entity: "customers",
      action: "upsert",
      recordId: customer.id,
      payload: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
      },
    });
  });

  return customer;
}

/**
 * Take money against a customer's outstanding balance.
 *
 * The local balance is reduced optimistically so the counter shows the debt
 * falling as the money is handed over. That figure is a cache: the server
 * recomputes it from the ledger and sends its own back, which is what stops two
 * tills settling the same debt from disagreeing about the remainder.
 *
 * The shift matters. A cash settlement is money in this drawer, and a till that
 * did not record which drawer took it would reconcile short by every debt paid
 * during the shift — while the server, which does know, came out right.
 */
export async function takePayment(input: {
  storeId: string;
  customer: LocalCustomer;
  amountMinor: number;
  method: string;
  orderId?: string | null;
  reference?: string | null;
  notes?: string | null;
  registerShiftId: string | null;
}): Promise<LocalPayment> {
  if (input.amountMinor <= 0) {
    throw new Error("Enter the amount the customer is paying.");
  }

  const owed = toMinor(input.customer.outstanding_balance);
  if (owed <= 0) {
    throw new Error(`${input.customer.name} does not owe anything.`);
  }

  if (input.amountMinor > owed) {
    // Refused rather than accepted as credit. Overpayment on account is a real
    // thing, but it is almost always a typo at a counter — and the money is
    // easier to hand back now than to explain on a statement later.
    throw new Error(`That is more than the ${toDecimal(owed)} outstanding. Take the balance, or correct the amount.`);
  }

  const payment: LocalPayment = {
    id: uuidv7(),
    store_id: input.storeId,
    customer_id: input.customer.id,
    customer_name: input.customer.name,
    order_id: input.orderId ?? null,
    register_shift_id: input.registerShiftId,
    method: input.method,
    amount: toDecimal(input.amountMinor),
    reference: input.reference?.trim() ? input.reference.trim() : null,
    notes: input.notes?.trim() ? input.notes.trim() : null,
    client_created_at: new Date().toISOString(),
    _state: "pending",
  };

  await db.transaction("rw", [db.payments, db.customers, db.outbox], async () => {
    await db.payments.put(payment);

    await db.customers.update(input.customer.id, {
      outstanding_balance: toDecimal(Math.max(0, owed - input.amountMinor)),
    });

    await enqueue({
      storeId: input.storeId,
      entity: "payments",
      action: "upsert",
      recordId: payment.id,
      payload: {
        id: payment.id,
        customer_id: payment.customer_id,
        order_id: payment.order_id,
        register_shift_id: payment.register_shift_id,
        method: payment.method,
        amount: payment.amount,
        reference: payment.reference,
        notes: payment.notes,
        client_created_at: payment.client_created_at,
      },
    });
  });

  return payment;
}
