import { api } from "@/src/core/api/client";
import { resolveStoreLogoUrl, uploadStoreLogoFromUri } from "@/src/services/laravelStorage";
import type {
  InviteRole,
  InviteStatus,
  AddUserInput,
  AddUserResult,
  PendingInvite,
  SendInviteInput,
  SendInviteResult,
  StoreMember,
  StoreSettings,
  StoreSettingsInput,
} from "./types";

/**
 * Store settings and staff, over the Laravel API.
 *
 * Replaces the invite-store-member Edge Function and the
 * accept_pending_store_invites RPC. The authorisation those performed by hand
 * with a service-role key now lives in the controller and the route's role gate.
 */

type StoreRow = {
  id: string;
  name: string;
  email?: string | null;
  logo_url?: string | null;
  tax_profile?: string;
  currency?: string;
  timezone?: string;
  language?: string;
  app_mode_dark?: boolean;
  tax_rate?: string | number;
  vat_rate?: string | number;
  service_rate?: string | number;
};

function mapSettings(row: StoreRow): StoreSettings {
  return {
    id: row.id,
    name: row.name ?? "",
    email: row.email ?? null,
    logoUrl: row.logo_url ?? null,
    language: row.language ?? "English",
    currency: row.currency ?? "USD",
    timezone: row.timezone ?? "UTC",
    taxProfile: row.tax_profile ?? "standard",
    appModeDark: Boolean(row.app_mode_dark),
    taxRate: Number(row.tax_rate ?? 0),
    vatRate: Number(row.vat_rate ?? 0),
    serviceRate: Number(row.service_rate ?? 0),
  };
}

type InviteRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at?: string | null;
  expires_at?: string | null;
};

function mapInvite(row: InviteRow): PendingInvite {
  return {
    id: row.id,
    email: row.email,
    role: row.role as InviteRole,
    status: row.status as InviteStatus,
    sentAt: row.created_at ?? new Date().toISOString(),
    expiresAt: row.expires_at ?? null,
  };
}

export const laravelSettingsService = {
  async getByStoreId(_storeId: string): Promise<StoreSettings | null> {
    const res = await api.get<{ data: StoreRow }>("/api/store");
    return res.data ? mapSettings(res.data) : null;
  },

  async update(_storeId: string, input: StoreSettingsInput): Promise<StoreSettings> {
    const res = await api.patch<{ data: StoreRow }>("/api/store", {
      name: input.name,
      email: input.email,
      language: input.language,
      currency: input.currency,
      timezone: input.timezone,
      tax_profile: input.taxProfile,
      app_mode_dark: input.appModeDark,
      tax_rate: input.taxRate,
      vat_rate: input.vatRate,
      service_rate: input.serviceRate,
    });

    return mapSettings(res.data);
  },

  async uploadLogo(storeId: string, localUri: string, mimeType?: string | null): Promise<string> {
    return uploadStoreLogoFromUri({ storeId, localUri, mimeType });
  },

  resolveLogoUrl: resolveStoreLogoUrl,

  async listMembers(_storeId: string): Promise<StoreMember[]> {
    const res = await api.get<{
      data: Array<{ user_id: string; role: string; name?: string | null; created_at?: string | null }>;
    }>("/api/store-members");

    return (res.data ?? []).map((m) => ({
      userId: m.user_id,
      fullName: m.name ?? "",
      // The server does not expose avatars on the staff list; the field exists
      // for the Supabase shape and is genuinely absent rather than guessed at.
      avatarUrl: null,
      role: m.role as StoreMember["role"],
      joinedAt: m.created_at ?? "",
    }));
  },

  async listPendingInvites(_storeId: string): Promise<PendingInvite[]> {
    const res = await api.get<{ data: InviteRow[] }>("/api/store-invites");
    return (res.data ?? []).filter((i) => i.status === "pending").map(mapInvite);
  },

  async addUser(_storeId: string, input: AddUserInput): Promise<AddUserResult> {
    const res = await api.post<{ member: { user_id: string; role: string; name?: string | null; created_at?: string | null } }>(
      "/api/store-members",
      {
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        password: input.password,
        role: input.role,
      },
    );

    return {
      member: {
        userId: res.member.user_id,
        fullName: res.member.name ?? input.name.trim(),
        avatarUrl: null,
        role: res.member.role as StoreMember["role"],
        joinedAt: res.member.created_at ?? new Date().toISOString(),
      },
    };
  },

  async sendInvite(_storeId: string, input: SendInviteInput): Promise<SendInviteResult> {
    const res = await api.post<{ invite: InviteRow; email_sent: boolean; message?: string }>(
      "/api/store-invites",
      { email: input.email.trim().toLowerCase(), role: input.role },
    );

    return {
      invite: mapInvite(res.invite),
      // The server has no mailer wired yet and says so rather than implying an
      // email went out. Passed through verbatim so staff know to tell the person.
      emailSent: res.email_sent,
      warning: res.email_sent ? undefined : res.message,
    };
  },

  async revokeInvite(_storeId: string, inviteId: string): Promise<void> {
    await api.delete(`/api/store-invites/${inviteId}`);
  },

  /**
   * Invites are accepted server-side during sign-in, so there is nothing for a
   * client to trigger. Returns an empty list because every caller already treats
   * this as best-effort.
   */
  async acceptPendingInvites(): Promise<{ storeId: string; role: string }[]> {
    return [];
  },

  async exportStoreCsv(_storeId: string): Promise<string> {
    const orders = await api.get<{ data: Array<Record<string, unknown>> }>("/api/orders", {
      per_page: 200,
    });

    const header = "order_number,client_created_at,status,total,amount_paid,payment_method";
    const body = (orders.data ?? [])
      .map((o) =>
        [o.order_number, o.client_created_at, o.status, o.total, o.amount_paid, o.payment_method]
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");

    return `${header}\n${body}`;
  },
};
