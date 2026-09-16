/** Platform-storage keys shared by offline sync + background recovery */
export const SYNC_STORAGE = {
  activeStoreId: "omnipos_sync_active_store_id",
  authCacheSession: "omnipos:cached_auth_session",
  productsCursorIso: "omnipos_sync_products_updated_after",
  customersCursorIso: "omnipos_sync_customers_updated_after",
  batchesCursorIso: "omnipos_sync_batches_updated_after",
} as const;
