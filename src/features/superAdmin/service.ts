import { supabase } from "@/src/services/supabase";
import type { ProvisionStoreInput, SystemStore } from "./types";

export const superAdminService = {
  async listAllStores(): Promise<SystemStore[]> {
    const { data: storesData, error: storesError } = await supabase
      .from("stores")
      .select("id, name, currency, timezone, tax_profile, owner_user_id, created_at")
      .order("created_at", { ascending: false });

    if (storesError) {
      throw storesError;
    }

    const stores = storesData ?? [];
    if (stores.length === 0) {
      return [];
    }

    const ownerUserIds = Array.from(new Set(stores.map((s) => s.owner_user_id).filter(Boolean)));

    let profilesMap: Record<string, { full_name?: string }> = {};
    if (ownerUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ownerUserIds);

      if (profiles) {
        profilesMap = Object.fromEntries(profiles.map((p) => [p.id, p]));
      }
    }

    return stores.map((row) => ({
      id: row.id,
      name: row.name ?? "",
      currency: row.currency ?? "USD",
      timezone: row.timezone ?? "UTC",
      taxProfile: row.tax_profile ?? "standard",
      ownerUserId: row.owner_user_id,
      createdAt: row.created_at,
      ownerName: profilesMap[row.owner_user_id]?.full_name ?? undefined,
    }));
  },

  async provisionStoreWithAdmin(input: ProvisionStoreInput) {
    const { data, error } = await supabase.functions.invoke("create-store-with-admin", {
      body: {
        storeName: input.storeName.trim(),
        currency: input.currency || "USD",
        timezone: input.timezone || "UTC",
        taxProfile: input.taxProfile || "standard",
        adminFullName: input.adminFullName.trim(),
        adminEmail: input.adminEmail.trim().toLowerCase(),
        adminPassword: input.adminPassword,
      },
    });

    if (error) {
      throw new Error(error.message || "Failed to provision store. Is the Edge Function deployed?");
    }

    const payload = data as {
      error?: string;
      store?: Record<string, unknown>;
      storeAdmin?: Record<string, unknown>;
    };

    if (payload.error) {
      throw new Error(payload.error);
    }

    return payload;
  },
};
