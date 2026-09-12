import { schemaMigrations, addColumns, createTable } from "@nozbe/watermelondb/Schema/migrations";

export default schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        addColumns({
          table: "products",
          columns: [{ name: "image_url", type: "string", isOptional: true }],
        }),
      ],
    },
    {
      toVersion: 3,
      steps: [
        addColumns({
          table: "products",
          columns: [{ name: "reorder_level", type: "number", isOptional: true }],
        }),
        createTable({
          name: "orders",
          columns: [
            { name: "store_id", type: "string", isIndexed: true },
            { name: "remote_id", type: "string", isOptional: true, isIndexed: true },
            { name: "cashier_user_id", type: "string" },
            { name: "order_number", type: "string", isIndexed: true },
            { name: "status", type: "string" },
            { name: "subtotal", type: "number" },
            { name: "tax", type: "number" },
            { name: "discount", type: "number" },
            { name: "total", type: "number" },
            { name: "amount_paid", type: "number" },
            { name: "change_due", type: "number" },
            { name: "payment_method", type: "string" },
            { name: "customer_name", type: "string", isOptional: true },
            { name: "customer_phone", type: "string", isOptional: true },
            { name: "customer_id", type: "string", isOptional: true },
            { name: "created_at", type: "number", isIndexed: true },
            { name: "dirty", type: "boolean" },
          ],
        }),
        createTable({
          name: "order_items",
          columns: [
            { name: "order_id", type: "string", isIndexed: true },
            { name: "store_id", type: "string", isIndexed: true },
            { name: "product_id", type: "string", isOptional: true },
            { name: "product_name", type: "string" },
            { name: "sku", type: "string", isOptional: true },
            { name: "barcode", type: "string", isOptional: true },
            { name: "unit_price", type: "number" },
            { name: "quantity", type: "number" },
            { name: "line_total", type: "number" },
          ],
        }),
        createTable({
          name: "customers",
          columns: [
            { name: "store_id", type: "string", isIndexed: true },
            { name: "remote_id", type: "string", isOptional: true, isIndexed: true },
            { name: "name", type: "string" },
            { name: "phone", type: "string", isOptional: true },
            { name: "email", type: "string", isOptional: true },
            { name: "total_spend", type: "number" },
            { name: "outstanding_balance", type: "number" },
            { name: "notes", type: "string", isOptional: true },
            { name: "updated_at", type: "number", isIndexed: true },
            { name: "dirty", type: "boolean" },
          ],
        }),
      ],
    },
    {
      toVersion: 4,
      steps: [
        createTable({
          name: "product_batches",
          columns: [
            { name: "store_id", type: "string", isIndexed: true },
            { name: "remote_id", type: "string", isOptional: true, isIndexed: true },
            { name: "product_id", type: "string", isIndexed: true },
            { name: "batch_number", type: "string", isIndexed: true },
            { name: "quantity", type: "number" },
            { name: "cost_price", type: "number", isOptional: true },
            { name: "expiry_date", type: "string", isOptional: true, isIndexed: true },
            { name: "created_at", type: "number", isIndexed: true },
            { name: "updated_at", type: "number", isIndexed: true },
            { name: "dirty", type: "boolean" },
          ],
        }),
        createTable({
          name: "stock_movements",
          columns: [
            { name: "store_id", type: "string", isIndexed: true },
            { name: "remote_id", type: "string", isOptional: true, isIndexed: true },
            { name: "product_id", type: "string", isIndexed: true },
            { name: "batch_id", type: "string", isOptional: true, isIndexed: true },
            { name: "type", type: "string", isIndexed: true },
            { name: "quantity", type: "number" },
            { name: "quantity_before", type: "number" },
            { name: "quantity_after", type: "number" },
            { name: "reason", type: "string" },
            { name: "notes", type: "string", isOptional: true },
            { name: "created_at", type: "number", isIndexed: true },
            { name: "dirty", type: "boolean" },
          ],
        }),
        createTable({
          name: "price_history",
          columns: [
            { name: "store_id", type: "string", isIndexed: true },
            { name: "remote_id", type: "string", isOptional: true, isIndexed: true },
            { name: "product_id", type: "string", isIndexed: true },
            { name: "old_sell_price", type: "number" },
            { name: "new_sell_price", type: "number" },
            { name: "old_cost_price", type: "number", isOptional: true },
            { name: "new_cost_price", type: "number", isOptional: true },
            { name: "reason", type: "string", isOptional: true },
            { name: "created_at", type: "number", isIndexed: true },
            { name: "dirty", type: "boolean" },
          ],
        }),
      ],
    },
    {
      toVersion: 5,
      steps: [
        addColumns({
          table: "products",
          columns: [{ name: "tags", type: "string", isOptional: true }],
        }),
      ],
    },
    {
      toVersion: 6,
      steps: [
        createTable({
          name: "register_shifts",
          columns: [
            { name: "store_id", type: "string", isIndexed: true },
            { name: "remote_id", type: "string", isOptional: true, isIndexed: true },
            { name: "cashier_user_id", type: "string", isIndexed: true },
            { name: "opened_at", type: "number", isIndexed: true },
            { name: "closed_at", type: "number", isOptional: true, isIndexed: true },
            { name: "opening_float", type: "number" },
            { name: "cash_sales", type: "number" },
            { name: "cash_in", type: "number" },
            { name: "cash_out", type: "number" },
            { name: "expected_cash", type: "number" },
            { name: "actual_cash", type: "number", isOptional: true },
            { name: "discrepancy", type: "number", isOptional: true },
            { name: "status", type: "string", isIndexed: true },
            { name: "notes", type: "string", isOptional: true },
            { name: "movements_json", type: "string", isOptional: true },
            { name: "dirty", type: "boolean" },
          ],
        }),
      ],
    },
    {
      toVersion: 7,
      steps: [
        addColumns({
          table: "stock_movements",
          columns: [
            { name: "source_type", type: "string", isOptional: true },
            { name: "source_id", type: "string", isOptional: true, isIndexed: true },
          ],
        }),
      ],
    },
    {
      toVersion: 8,
      steps: [
        addColumns({
          table: "orders",
          columns: [{ name: "refunded_amount", type: "number", isOptional: true }],
        }),
      ],
    },
  ],
});
