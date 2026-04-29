import { supabase } from "@/src/services/supabase";
import { Store } from "@/src/types/store";

type MembershipRow = {
  store_id: string;
};

function mapStore(row: any): Store {
  return {
    id: row.id,
    name: row.name ?? "",
    taxProfile: row.tax_profile ?? "standard",
    currency: row.currency ?? "USD",
    timezone: row.timezone ?? "UTC",
  };
}

export const storesService = {
  async list(): Promise<Store[]> {
    const { data: memberships, error: membershipError } = await supabase
      .from("store_members")
      .select("store_id")
      .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "");

    if (membershipError) {
      throw membershipError;
    }

    const storeIds = (memberships ?? []).map((row: MembershipRow) => row.store_id);
    if (storeIds.length === 0) {
      return [];
    }

    const { data, error } = await supabase
      .from("stores")
      .select("id, name, tax_profile, currency, timezone")
      .in("id", storeIds);

    if (error) {
      throw error;
    }

    return (data ?? []).map(mapStore);
  },

  async upsertActiveStoreProfile(input: {
    activeStoreId: string;
    name: string;
    taxProfile: string;
    currency: string;
    timezone: string;
  }) {
    const { data, error } = await supabase
      .from("stores")
      .update({
        name: input.name,
        tax_profile: input.taxProfile,
        currency: input.currency,
        timezone: input.timezone,
      })
      .eq("id", input.activeStoreId)
      .select("id, name, tax_profile, currency, timezone")
      .single();

    if (error) {
      throw error;
    }

    return mapStore(data);
  },
};
