import { api } from "@/src/core/api/client";
import type { ProvisionStoreInput, SystemStore } from "./types";

/**
 * Platform operations, over the Laravel API.
 *
 * Replaces the create-store-with-admin Edge Function and the
 * provision_store_with_admin RPC. Both ran with a service-role key that bypassed
 * row-level security entirely; the server now verifies the super-admin
 * privilege itself, so the client is an ordinary caller with no elevated
 * credentials of its own.
 *
 * The three-fallback chain the Supabase version needed — Edge Function, then
 * RPC, then a hand-rolled insert — is gone. One endpoint does the whole thing in
 * a transaction, so there is no path that leaves a store without an admin.
 */

type StoreRow = {
  id: string;
  name: string;
  currency?: string;
  timezone?: string;
  tax_profile?: string;
  members_count?: number;
  orders_count?: number;
  owner?: { id: string; name: string; email: string } | null;
  created_at?: string | null;
};

export const laravelSuperAdminService = {
  async listAllStores(): Promise<SystemStore[]> {
    const res = await api.get<{ data: StoreRow[] }>("/api/admin/stores", undefined, { storeless: true });

    return (res.data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      currency: s.currency ?? "USD",
      timezone: s.timezone ?? "UTC",
      taxProfile: s.tax_profile ?? "standard",
      ownerUserId: s.owner?.id ?? "",
      createdAt: s.created_at ?? "",
      ownerName: s.owner?.name ?? "",
      ownerEmail: s.owner?.email ?? "",
    }));
  },

  async provisionStoreWithAdmin(input: ProvisionStoreInput) {
    const res = await api.post<{
      store: { id: string; name: string; currency: string; timezone: string };
      admin: { id: string; name: string; email: string };
      account_created: boolean;
    }>(
      "/api/admin/stores",
      {
        store_name: input.storeName,
        currency: input.currency,
        timezone: input.timezone,
        tax_profile: input.taxProfile,
        admin_email: input.adminEmail,
        admin_name: input.adminFullName,
        admin_password: input.adminPassword,
      },
      { storeless: true },
    );

    return {
      store: res.store,
      storeAdmin: {
        id: res.admin.id,
        email: res.admin.email,
        fullName: res.admin.name,
      },
      // Lets the caller say "here are their credentials" or "their existing
      // login now has access", rather than guessing which happened.
      accountCreated: res.account_created,
    };
  },
};
