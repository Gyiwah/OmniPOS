import { Q } from "@nozbe/watermelondb";
import { database } from "@/src/database";
import Customer from "@/src/database/models/Customer";
import Order from "@/src/database/models/Order";
import { uuidv7 } from "@/src/core/ids/uuidv7";
import { enqueueChange } from "@/src/sync/enqueue";
import { synchronise } from "@/src/sync";
import { getActiveShift } from "@/src/features/shifts/service";
import type { SettleBalancePayload } from "./customerService";

/**
 * Settling a customer's balance, over the Laravel API.
 *
 * The Supabase version wrote the new balance itself — it pushed
 * outstanding_balance and total_spend up as customer fields. The Laravel server
 * refuses those outright, and rightly: they are derived from orders and
 * payments, and a phone that synced late would otherwise reinstate a debt the
 * customer had already settled at another till.
 *
 * That refusal is exactly why this file exists. Under Laravel the old path
 * recorded no payment at all — the local balance fell, the server's did not, and
 * the next pull put the debt back. The money simply disappeared.
 *
 * So a settlement is now what it actually is: a payment. One queued operation
 * per payment, each with its own id, which is what makes a retry after a dropped
 * connection credit the customer once rather than twice.
 */
export async function settleCustomerBalanceViaLaravel(
  payload: SettleBalancePayload,
): Promise<{ totalPaid: number; remainingBalance: number }> {
  const { storeId, customerId, paymentMethod, notes, payments } = payload;

  const applicable = payments.filter((p) => p.paymentAmount > 0);
  if (applicable.length === 0) {
    return { totalPaid: 0, remainingBalance: await currentBalance(storeId, customerId) };
  }

  // A cash settlement is money in this drawer. Without the link the drawer
  // reconciles short by every debt paid during the shift.
  const shift = await getActiveShift(storeId);

  let totalPaid = 0;

  for (const item of applicable) {
    const orderRemoteId = await resolveOrderId(storeId, item.orderId);

    await enqueueChange({
      storeId,
      entity: "payments",
      operation: "upsert",
      // The payment's own id, minted once. The server deduplicates on it.
      recordId: uuidv7(),
      payload: {
        customer_id: customerId,
        order_id: orderRemoteId,
        register_shift_id: shift?.id ?? null,
        method: paymentMethod,
        amount: item.paymentAmount,
        notes: notes ?? null,
        client_created_at: new Date().toISOString(),
      },
    });

    totalPaid += item.paymentAmount;
  }

  const remaining = await applyOptimistically(storeId, customerId, totalPaid);

  void synchronise(storeId);

  return { totalPaid, remainingBalance: remaining };
}

/**
 * The id the server knows this sale by.
 *
 * Records created before the identity work carry a separate remote_id; ones
 * created since are the same on both sides. Sending the local id for an older
 * order would have the server reject the payment for naming a sale it has never
 * seen.
 */
async function resolveOrderId(storeId: string, orderId: string): Promise<string | null> {
  if (!orderId) return null;

  const rows = await database
    .get<Order>("orders")
    .query(Q.where("store_id", storeId), Q.where("id", orderId))
    .fetch();

  const order = rows[0];
  if (!order) return null;

  return order.remoteId || order.id;
}

/**
 * Show the debt falling as the money is handed over.
 *
 * Local only, and deliberately not pushed: the figure the shop runs on is the
 * server's, recomputed from the ledger, and it arrives through the changefeed.
 * This is what the cashier sees in the meantime.
 *
 * total_spend is left alone. The old code added the payment to it, which was
 * wrong twice over — spend is what the customer bought, not what they paid, and
 * settling a debt would have inflated their lifetime value by the same money
 * twice.
 */
async function applyOptimistically(storeId: string, customerId: string, paid: number): Promise<number> {
  const customer = await findCustomer(storeId, customerId);
  if (!customer) return 0;

  const next = Math.max(0, Number(customer.outstandingBalance ?? 0) - paid);

  await database.write(async () => {
    await customer.update((rec) => {
      rec.outstandingBalance = next;
      rec.updatedAt = Date.now();
    });
  });

  return next;
}

async function currentBalance(storeId: string, customerId: string): Promise<number> {
  const customer = await findCustomer(storeId, customerId);
  return Number(customer?.outstandingBalance ?? 0);
}

async function findCustomer(storeId: string, customerId: string): Promise<Customer | null> {
  try {
    return await database.get<Customer>("customers").find(customerId);
  } catch {
    const rows = await database
      .get<Customer>("customers")
      .query(Q.where("store_id", storeId), Q.where("id", customerId))
      .fetch();

    return rows[0] ?? null;
  }
}
