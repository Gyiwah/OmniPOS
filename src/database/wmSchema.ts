import { appSchema, tableSchema } from "@nozbe/watermelondb";

export const SCHEMA_VERSION = 2;

export default appSchema({
  version: SCHEMA_VERSION,
  tables: [
    tableSchema({
      name: "products",
      columns: [
        { name: "store_id", type: "string", isIndexed: true },
        { name: "remote_id", type: "string", isOptional: true, isIndexed: true },
        { name: "name", type: "string" },
        { name: "sku", type: "string", isIndexed: true },
        { name: "barcode", type: "string", isOptional: true },
        { name: "stock", type: "number" },
        { name: "sell_price", type: "number" },
        { name: "cost_price", type: "number", isOptional: true },
        { name: "image_url", type: "string", isOptional: true },
        { name: "updated_at", type: "number", isIndexed: true },
        { name: "dirty", type: "boolean" },
      ],
    }),
    tableSchema({
      name: "sync_queue",
      columns: [
        { name: "store_id", type: "string", isIndexed: true },
        { name: "entity", type: "string", isIndexed: true },
        { name: "operation", type: "string" },
        { name: "payload", type: "string" },
        { name: "record_id", type: "string", isOptional: true },
        { name: "remote_id", type: "string", isOptional: true },
        { name: "status", type: "string", isIndexed: true },
        { name: "attempts", type: "number" },
        { name: "last_error", type: "string", isOptional: true },
      ],
    }),
  ],
});
