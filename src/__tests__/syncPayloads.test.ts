import { buildOrderRowForSupabase } from "../sync/orderRow";
import { buildCustomerRowForSupabase } from "../sync/customerRow";

describe("syncPayloads", () => {
  it("formats order insert payload correctly for Supabase", () => {
    const orderPayload = {
      store_id: "store-123",
      cashier_user_id: "user-abc",
      order_number: "ORD-1001",
      status: "completed",
      subtotal: 100,
      tax: 5,
      discount: 10,
      total: 95,
      amount_paid: 100,
      change_due: 5,
      payment_method: "card",
      items: [
        {
          product_name: "Test Item",
          unit_price: 50,
          quantity: 2,
          line_total: 100,
        },
      ],
    };

    const row = buildOrderRowForSupabase(orderPayload);
    expect(row.store_id).toBe("store-123");
    expect(row.payment_method).toBe("card");
    expect(row.subtotal).toBe(100);
    expect(row.total).toBe(95);
  });

  it("formats customer upsert payload correctly for Supabase", () => {
    const customerPayload = {
      store_id: "store-123",
      name: "John Doe",
      phone: "0240001122",
      email: "john@example.com",
      total_spend: 250.5,
    };

    const row = buildCustomerRowForSupabase(customerPayload);
    expect(row.store_id).toBe("store-123");
    expect(row.name).toBe("John Doe");
    expect(row.phone).toBe("0240001122");
    expect(row.total_spend).toBe(250.5);
  });
});
