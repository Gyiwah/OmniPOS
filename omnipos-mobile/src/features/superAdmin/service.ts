import { supabase } from "@/src/services/supabase";
import type { ProvisionStoreInput, SystemStore } from "./types";
import { usingLaravel } from "@/src/core/api/config";
import { laravelSuperAdminService } from "./laravelSuperAdmin";

const supabaseSuperAdminService = {
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
    // 1. Try Edge Function
    try {
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

      if (!error && data) {
        const payload = data as {
          error?: string;
          store?: Record<string, unknown>;
          storeAdmin?: Record<string, unknown>;
        };
        if (payload.error) {
          throw new Error(payload.error);
        }
        return payload;
      }

      if (error) {
        let detailedMessage = "";
        try {
          if ("context" in error && (error as any).context) {
            const body = await (error as any).context.json();
            if (body?.error) {
              detailedMessage = body.error;
            }
          }
        } catch {
          // ignore context parsing error
        }
        if (detailedMessage) {
          throw new Error(detailedMessage);
        }
      }
    } catch (edgeFnError) {
      const edgeMsg = edgeFnError instanceof Error ? edgeFnError.message : "";
      // If error was a business logic error (e.g. invalid password, user unauthorized), propagate it
      if (
        edgeMsg &&
        !edgeMsg.includes("non-2xx") &&
        !edgeMsg.includes("Failed to send") &&
        !edgeMsg.includes("Failed to provision") &&
        !edgeMsg.includes("404")
      ) {
        throw edgeFnError;
      }
    }

    // 2. Fallback: Try PostgreSQL RPC function
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc("provision_store_with_admin", {
        p_store_name: input.storeName.trim(),
        p_currency: input.currency || "USD",
        p_timezone: input.timezone || "UTC",
        p_tax_profile: input.taxProfile || "standard",
        p_admin_email: input.adminEmail.trim().toLowerCase(),
        p_admin_full_name: input.adminFullName.trim(),
      });

      if (!rpcError && rpcData) {
        return rpcData as {
          store?: Record<string, unknown>;
          storeAdmin?: Record<string, unknown>;
        };
      }
    } catch {
      // ignore and continue to direct client fallback
    }

    // 3. Fallback: Direct Database store creation
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new Error("You must be logged in as Super Admin to provision a store.");
    }

    const { data: storeRow, error: storeErr } = await supabase
      .from("stores")
      .insert({
        name: input.storeName.trim(),
        currency: input.currency || "USD",
        timezone: input.timezone || "UTC",
        tax_profile: input.taxProfile || "standard",
        owner_user_id: user.id,
      })
      .select("id, name, currency, timezone, tax_profile, owner_user_id, created_at")
      .single();

    if (storeErr || !storeRow) {
      throw new Error(
        storeErr?.message ||
          "Failed to provision store. Please verify you have Super Admin role or run SQL migration 011."
      );
    }

    await supabase.from("store_members").upsert(
      {
        store_id: storeRow.id,
        user_id: user.id,
        role: "admin",
      },
      { onConflict: "store_id,user_id" }
    );

    return {
      store: storeRow,
      storeAdmin: {
        id: user.id,
        email: input.adminEmail,
        fullName: input.adminFullName,
      },
    };
  },
};

/**
 * Which implementation answers is decided once, from build configuration.
 *
 * The Supabase version needed three fallbacks — Edge Function, then RPC, then a
 * hand-rolled insert — because any of them could be missing from a given
 * project. The Laravel path is one endpoint in one transaction, so a store can
 * never end up without an admin.
 */
export const superAdminService = usingLaravel ? laravelSuperAdminService : supabaseSuperAdminService;
