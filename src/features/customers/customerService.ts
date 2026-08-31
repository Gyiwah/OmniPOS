import { Q } from "@nozbe/watermelondb";
import { network } from "@/src/core/platform";

import { database } from "@/src/database";
import type Customer from "@/src/database/models/Customer";
import type Order from "@/src/database/models/Order";
import { supabase } from "@/src/services/supabase";
import { enqueueChange } from "@/src/sync/enqueue";
import { runSyncCycle } from "@/src/sync/syncEngine";

export type CustomerProfileData = {
  id: string;
  storeId: string;
  remoteId?: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  totalSpend: number;
  outstandingBalance: number;
  createdAt?: number;
  updatedAt?: number;
};

export type CustomerOrderSummary = {
  id: string;
  orderNumber: string;
  createdAt: number | string;
  total: number;
  amountPaid: number;
  unpaidBalance: number;
  status: string;
  paymentMethod: string;
};

export type SettlePaymentItem = {
  orderId: string;
  paymentAmount: number;
};

export type SettleBalancePayload = {
  storeId: string;
  customerId: string;
  paymentMethod: string;
  notes?: string;
  payments: SettlePaymentItem[];
};

/**
 * Updates customer personal details (name, phone, email, notes)
 */
export async function updateCustomerProfile(
  storeId: string,
  customerId: string,
  data: {
    name: string;
    phone?: string;
    email?: string;
    notes?: string;
  }
): Promise<void> {
  const now = Date.now();
  let localCustomer: Customer | null = null;

  try {
    localCustomer = await database.get<Customer>("customers").find(customerId);
  } catch {
    const rows = await database
      .get<Customer>("customers")
      .query(Q.where("store_id", storeId), Q.where("id", customerId))
      .fetch();
    localCustomer = rows[0] ?? null;
  }

  if (!localCustomer) {
    throw new Error("Customer record not found locally.");
  }

  const cleanName = data.name.trim();
  const cleanPhone = data.phone?.trim() || null;
  const cleanEmail = data.email?.trim() || null;
  const cleanNotes = data.notes?.trim() || null;

  await database.write(async () => {
    await localCustomer.update((rec) => {
      rec.name = cleanName;
      rec.phone = cleanPhone ?? undefined;
      rec.email = cleanEmail ?? undefined;
      rec.notes = cleanNotes ?? undefined;
      rec.updatedAt = now;
      rec.dirty = true;
    });
  });

  const remoteId = localCustomer.remoteId || localCustomer.id;
  const payload = {
    id: remoteId,
    store_id: storeId,
    name: cleanName,
    phone: cleanPhone,
    email: cleanEmail,
    notes: cleanNotes,
    total_spend: Number(localCustomer.totalSpend ?? 0),
    outstanding_balance: Number(localCustomer.outstandingBalance ?? 0),
  };

  let syncedDirectly = false;
  try {
    const net = await network.getState();
    if (net.isConnected) {
      const { error } = await supabase.from("customers").upsert(payload, { onConflict: "id" });
      if (!error) {
        syncedDirectly = true;
        await database.write(async () => {
          await localCustomer.update((rec) => {
            rec.dirty = false;
          });
        });
      }
    }
  } catch {
    // fallback to sync queue
  }

  if (!syncedDirectly) {
    await enqueueChange({
      storeId,
      entity: "customers",
      operation: "upsert",
      recordId: localCustomer.id,
      payload,
    });
    void runSyncCycle(storeId);
  }
}

/**
 * Loads a customer's full profile and order history
 */
export async function getCustomerWithHistory(
  storeId: string,
  customerId: string
): Promise<{
  customer: CustomerProfileData | null;
  orders: CustomerOrderSummary[];
}> {
  let custRecord: Customer | null = null;
  try {
    custRecord = await database.get<Customer>("customers").find(customerId);
  } catch {
    const matches = await database
      .get<Customer>("customers")
      .query(Q.where("store_id", storeId), Q.where("id", customerId))
      .fetch();
    custRecord = matches[0] ?? null;
  }

  const customerData: CustomerProfileData | null = custRecord
    ? {
        id: custRecord.id,
        storeId: custRecord.storeId,
        remoteId: custRecord.remoteId,
        name: custRecord.name,
        phone: custRecord.phone,
        email: custRecord.email,
        notes: custRecord.notes,
        totalSpend: Number(custRecord.totalSpend ?? 0),
        outstandingBalance: Number(custRecord.outstandingBalance ?? 0),
        createdAt: custRecord.updatedAt,
        updatedAt: custRecord.updatedAt,
      }
    : null;

  // Local orders query
  const localOrders = await database
    .get<Order>("orders")
    .query(
      Q.where("store_id", storeId),
      Q.or(
        Q.where("customer_id", customerId),
        custRecord?.phone ? Q.where("customer_phone", custRecord.phone) : Q.where("customer_id", customerId),
        custRecord?.name ? Q.where("customer_name", custRecord.name) : Q.where("customer_id", customerId)
      )
    )
    .fetch();

  const localSummaries: CustomerOrderSummary[] = localOrders.map((o) => {
    const total = Number(o.total ?? 0);
    const paid = Number(o.amountPaid ?? 0);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      total,
      amountPaid: paid,
      unpaidBalance: Math.max(0, total - paid),
      status: o.status,
      paymentMethod: o.paymentMethod || "cash",
    };
  });

  // Cloud orders sync if available
  try {
    let qb = supabase
      .from("orders")
      .select("id, order_number, created_at, total, amount_paid, status, payment_method")
      .eq("store_id", storeId);

    if (custRecord?.phone) {
      qb = qb.or(`customer_id.eq.${customerId},customer_phone.eq.${custRecord.phone}`);
    } else {
      qb = qb.eq("customer_id", customerId);
    }

    const { data: cloudOrders } = await qb.order("created_at", { ascending: false });

    if (cloudOrders && cloudOrders.length > 0) {
      const mergedMap = new Map<string, CustomerOrderSummary>();
      for (const lo of localSummaries) {
        mergedMap.set(lo.orderNumber, lo);
      }
      for (const co of cloudOrders) {
        const total = Number(co.total ?? 0);
        const paid = Number(co.amount_paid ?? 0);
        mergedMap.set(co.order_number, {
          id: co.id,
          orderNumber: co.order_number,
          createdAt: co.created_at,
          total,
          amountPaid: paid,
          unpaidBalance: Math.max(0, total - paid),
          status: co.status,
          paymentMethod: co.payment_method || "cash",
        });
      }
      const sorted = Array.from(mergedMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      return { customer: customerData, orders: sorted };
    }
  } catch {
    // ignore cloud fetch error
  }

  localSummaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { customer: customerData, orders: localSummaries };
}

/**
 * Settles outstanding balance for a customer across selected orders
 */
export async function settleCustomerBalance(
  payload: SettleBalancePayload
): Promise<{ totalPaid: number; remainingBalance: number }> {
  const { storeId, customerId, payments } = payload;
  const now = Date.now();

  let totalPaymentProcessed = 0;

  // 1. Process each order payment
  for (const item of payments) {
    if (item.paymentAmount <= 0) continue;

    let orderRec: Order | null = null;
    try {
      orderRec = await database.get<Order>("orders").find(item.orderId);
    } catch {
      const rows = await database
        .get<Order>("orders")
        .query(Q.where("store_id", storeId), Q.where("id", item.orderId))
        .fetch();
      orderRec = rows[0] ?? null;
    }

    if (orderRec) {
      const currentPaid = Number(orderRec.amountPaid ?? 0);
      const totalAmount = Number(orderRec.total ?? 0);
      const nextPaid = Math.min(totalAmount, currentPaid + item.paymentAmount);
      const isFullyPaid = nextPaid >= totalAmount - 0.01;
      const nextStatus = isFullyPaid ? "completed" : "part_paid";

      await database.write(async () => {
        await orderRec.update((rec) => {
          rec.amountPaid = nextPaid;
          rec.status = nextStatus;
          rec.dirty = true;
        });
      });

      totalPaymentProcessed += item.paymentAmount;

      // Sync order update
      const remoteOrderId = orderRec.remoteId || orderRec.id;
      const orderPayload = {
        id: remoteOrderId,
        store_id: storeId,
        amount_paid: nextPaid,
        status: nextStatus,
        dirty: true,
      };

      try {
        const net = await network.getState();
        if (net.isConnected) {
          await supabase
            .from("orders")
            .update({ amount_paid: nextPaid, status: nextStatus })
            .eq("id", remoteOrderId);
        } else {
          await enqueueChange({
            storeId,
            entity: "orders",
            operation: "upsert",
            recordId: orderRec.id,
            payload: orderPayload,
          });
        }
      } catch {
        await enqueueChange({
          storeId,
          entity: "orders",
          operation: "upsert",
          recordId: orderRec.id,
          payload: orderPayload,
        });
      }
    }
  }

  // 2. Update customer balance and total spend
  let custRec: Customer | null = null;
  try {
    custRec = await database.get<Customer>("customers").find(customerId);
  } catch {
    const rows = await database
      .get<Customer>("customers")
      .query(Q.where("store_id", storeId), Q.where("id", customerId))
      .fetch();
    custRec = rows[0] ?? null;
  }

  let finalRemainingBalance = 0;

  if (custRec) {
    const currentBal = Number(custRec.outstandingBalance ?? 0);
    const currentSpend = Number(custRec.totalSpend ?? 0);
    const nextBal = Math.max(0, currentBal - totalPaymentProcessed);
    const nextSpend = currentSpend + totalPaymentProcessed;
    finalRemainingBalance = nextBal;

    await database.write(async () => {
      await custRec.update((rec) => {
        rec.outstandingBalance = nextBal;
        rec.totalSpend = nextSpend;
        rec.updatedAt = now;
        rec.dirty = true;
      });
    });

    const custRemoteId = custRec.remoteId || custRec.id;
    const custPayload = {
      id: custRemoteId,
      store_id: storeId,
      name: custRec.name,
      phone: custRec.phone ?? null,
      email: custRec.email ?? null,
      notes: custRec.notes ?? null,
      total_spend: nextSpend,
      outstanding_balance: nextBal,
    };

    try {
      const net = await network.getState();
      if (net.isConnected) {
        await supabase.from("customers").upsert(custPayload, { onConflict: "id" });
      } else {
        await enqueueChange({
          storeId,
          entity: "customers",
          operation: "upsert",
          recordId: custRec.id,
          payload: custPayload,
        });
      }
    } catch {
      await enqueueChange({
        storeId,
        entity: "customers",
        operation: "upsert",
        recordId: custRec.id,
        payload: custPayload,
      });
    }
  }

  void runSyncCycle(storeId);

  return {
    totalPaid: totalPaymentProcessed,
    remainingBalance: finalRemainingBalance,
  };
}
