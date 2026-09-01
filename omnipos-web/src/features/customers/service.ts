import { uuidv7 } from "@/core/uuidv7";
import { db, type LocalCustomer } from "@/db/schema";
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
