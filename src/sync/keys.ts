/** AsyncStorage keys shared by offline sync + background recovery */
export const SYNC_STORAGE = {
  activeStoreId: "omnipos_sync_active_store_id",
  productsCursorIso: "omnipos_sync_products_updated_after",
} as const;
