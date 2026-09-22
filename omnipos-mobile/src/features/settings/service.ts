import { createDeepLink } from "@/src/core/platform";
import { supabase } from "@/src/services/supabase";
import { uploadStoreLogoFromUri, resolveStoreLogoUrl } from "@/src/services/storage";

import type {
  AddUserInput,
  AddUserResult,
  PendingInvite,
  SendInviteInput,
  SendInviteResult,
  StoreMember,
  StoreSettings,
  StoreSettingsInput,
} from "./types";
import { usingLaravel } from "@/src/core/api/config";
import { laravelSettingsService } from "./laravelSettings";

const STORE_SETTINGS_SELECT =
  "id, name, email, logo_url, language, currency, timezone, tax_profile, app_mode_dark, tax_rate, vat_rate, service_rate";

function mapStoreSettings(row: Record<string, unknown>): StoreSettings {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    email: row.email ? String(row.email) : null,
    logoUrl: row.logo_url ? String(row.logo_url) : null,
    language: String(row.language ?? "English"),
    currency: String(row.currency ?? "USD"),
    timezone: String(row.timezone ?? "UTC"),
    taxProfile: String(row.tax_profile ?? "standard"),
    appModeDark: Boolean(row.app_mode_dark),
    taxRate: Number(row.tax_rate ?? 0),
    vatRate: Number(row.vat_rate ?? 0),
    serviceRate: Number(row.service_rate ?? 0),
  };
}

function mapMember(row: Record<string, unknown>): StoreMember {
  const profile = (row.profiles ?? {}) as Record<string, unknown>;
  return {
    userId: String(row.user_id),
    fullName: String(profile.full_name ?? "Team member"),
    avatarUrl: profile.avatar_url ? String(profile.avatar_url) : null,
    role: String(row.role) as StoreMember["role"],
    joinedAt: String(row.created_at ?? ""),
  };
}

function mapInvite(row: Record<string, unknown>): PendingInvite {
  return {
    id: String(row.id),
    email: String(row.email ?? ""),
    role: String(row.role) as PendingInvite["role"],
    status: String(row.status ?? "pending") as PendingInvite["status"],
    sentAt: String(row.created_at ?? ""),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
  };
}

const supabaseSettingsService = {
  async getByStoreId(storeId: string): Promise<StoreSettings | null> {
    const { data, error } = await supabase
      .from("stores")
      .select(STORE_SETTINGS_SELECT)
      .eq("id", storeId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return mapStoreSettings(data as Record<string, unknown>);
  },

  async update(storeId: string, input: StoreSettingsInput): Promise<StoreSettings> {
    const payload: Record<string, unknown> = {};
    if (input.name !== undefined) payload.name = input.name;
    if (input.email !== undefined) payload.email = input.email;
    if (input.logoUrl !== undefined) payload.logo_url = input.logoUrl;
    if (input.language !== undefined) payload.language = input.language;
    if (input.currency !== undefined) payload.currency = input.currency;
    if (input.timezone !== undefined) payload.timezone = input.timezone;
    if (input.taxProfile !== undefined) payload.tax_profile = input.taxProfile;
    if (input.appModeDark !== undefined) payload.app_mode_dark = input.appModeDark;
    if (input.taxRate !== undefined) payload.tax_rate = input.taxRate;
    if (input.vatRate !== undefined) payload.vat_rate = input.vatRate;
    if (input.serviceRate !== undefined) payload.service_rate = input.serviceRate;

    const { data, error } = await supabase
      .from("stores")
      .update(payload)
      .eq("id", storeId)
      .select(STORE_SETTINGS_SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new Error("Store not found or update not permitted.");
    }
    return mapStoreSettings(data as Record<string, unknown>);
  },

  async uploadLogo(storeId: string, localUri: string, mimeType?: string | null): Promise<string> {
    return uploadStoreLogoFromUri({ storeId, localUri, mimeType });
  },

  resolveLogoUrl: resolveStoreLogoUrl,

  async listMembers(storeId: string): Promise<StoreMember[]> {
    const { data, error } = await supabase
      .from("store_members")
      .select("user_id, role, created_at, profiles!user_id(full_name, avatar_url)")
      .eq("store_id", storeId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return (data ?? []).map((row) => mapMember(row as Record<string, unknown>));
  },

  async listPendingInvites(storeId: string): Promise<PendingInvite[]> {
    const { data, error } = await supabase
      .from("store_invites")
      .select("id, email, role, status, created_at, expires_at")
      .eq("store_id", storeId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []).map((row) => mapInvite(row as Record<string, unknown>));
  },

  async sendInvite(storeId: string, input: SendInviteInput): Promise<SendInviteResult> {
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) {
      throw new Error("Enter a valid email address.");
    }

    const { data, error } = await supabase.functions.invoke("invite-store-member", {
      body: {
        storeId,
        email,
        role: input.role,
        resend: Boolean(input.resend),
        redirectTo: createDeepLink("/auth/callback"),
      },
    });

    if (error) {
      throw new Error(error.message || "Failed to send invite. Is the invite-store-member function deployed?");
    }

    const payload = data as {
      error?: string;
      warning?: string;
      emailSent?: boolean;
      invite?: Record<string, unknown>;
    };

    if (payload?.error && !payload.invite) {
      throw new Error(payload.error);
    }
    if (!payload?.invite) {
      throw new Error("Invite response was empty.");
    }

    return {
      invite: mapInvite(payload.invite),
      emailSent: Boolean(payload.emailSent),
      warning: payload.warning ?? payload.error,
    };
  },

  async addUser(_storeId: string, _input: AddUserInput): Promise<AddUserResult> {
    throw new Error("Direct user creation is only available on the Laravel backend.");
  },

  async revokeInvite(storeId: string, inviteId: string): Promise<void> {
    const { error } = await supabase
      .from("store_invites")
      .update({ status: "revoked" })
      .eq("id", inviteId)
      .eq("store_id", storeId);

    if (error) throw error;
  },

  async acceptPendingInvites(): Promise<{ storeId: string; role: string }[]> {
    const { data, error } = await supabase.rpc("accept_pending_store_invites");
    if (error) throw error;
    return (data ?? []).map((row: { store_id: string; role: string }) => ({
      storeId: row.store_id,
      role: row.role,
    }));
  },

  async exportStoreCsv(storeId: string): Promise<string> {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [{ data: orders, error: ordersError }, { data: returns, error: returnsError }] = await Promise.all([
      supabase
        .from("orders")
        .select("order_number, total, status, created_at")
        .eq("store_id", storeId)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false }),
      supabase
        .from("returns")
        .select("amount, reason, created_at")
        .eq("store_id", storeId)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false }),
    ]);

    if (ordersError) throw ordersError;
    if (returnsError) throw returnsError;

    const lines = ["type,reference,amount,status_or_reason,created_at"];
    for (const order of orders ?? []) {
      lines.push(
        ["order", order.order_number, Number(order.total ?? 0).toFixed(2), order.status, order.created_at].join(","),
      );
    }
    for (const row of returns ?? []) {
      lines.push(
        [
          "return",
          "",
          Number(row.amount ?? 0).toFixed(2),
          `"${String(row.reason ?? "").replace(/"/g, '""')}"`,
          row.created_at,
        ].join(","),
      );
    }
    return lines.join("\n");
  },
};

/**
 * Which implementation answers is decided once, here, from build configuration.
 *
 * Callers import settingsService and never learn the transport, so retiring
 * Supabase is a deletion plus one edit rather than a change at every call site.
 */
export const settingsService = usingLaravel ? (laravelSettingsService as typeof supabaseSettingsService) : supabaseSettingsService;
