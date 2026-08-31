import { api } from "@/src/core/api/client";
import { Store } from "@/src/types/store";

/**
 * Stores, over the Laravel API.
 *
 * The membership join the Supabase version had to do by hand is gone: the server
 * already scopes /api/stores to the caller's memberships, so a client cannot ask
 * for a store it does not belong to.
 */

type StoreRow = {
  id: string;
  name: string;
  tax_profile?: string;
  currency?: string;
  timezone?: string;
};

function mapStore(row: StoreRow): Store {
  return {
    id: row.id,
    name: row.name ?? "",
    taxProfile: row.tax_profile ?? "standard",
    currency: row.currency ?? "USD",
    timezone: row.timezone ?? "UTC",
  };
}

export const laravelStoresService = {
  async list(): Promise<Store[]> {
    const res = await api.get<{ data: StoreRow[] }>("/api/stores", undefined, { storeless: true });
    return (res.data ?? []).map(mapStore);
  },

  async upsertActiveStoreProfile(input: {
    activeStoreId: string;
    name: string;
    taxProfile: string;
    currency: string;
    timezone: string;
  }): Promise<Store> {
    const res = await api.patch<{ data: StoreRow }>("/api/store", {
      name: input.name,
      tax_profile: input.taxProfile,
      currency: input.currency,
      timezone: input.timezone,
    });

    return mapStore(res.data);
  },

  async create(name: string): Promise<Store> {
    // The server makes the creator an admin in the same transaction, so there
    // is no second call that can fail and leave a store nobody can administer.
    const res = await api.post<{ data: StoreRow }>(
      "/api/stores",
      { name: name.trim() || "New Store" },
      { storeless: true },
    );

    return mapStore(res.data);
  },
};
