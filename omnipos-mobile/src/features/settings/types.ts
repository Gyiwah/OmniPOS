export type StoreSettings = {
  id: string;
  name: string;
  email: string | null;
  logoUrl: string | null;
  language: string;
  currency: string;
  timezone: string;
  taxProfile: string;
  appModeDark: boolean;
  taxRate: number;
  vatRate: number;
  serviceRate: number;
};

export type StoreSettingsInput = {
  name?: string;
  email?: string | null;
  logoUrl?: string | null;
  language?: string;
  currency?: string;
  timezone?: string;
  taxProfile?: string;
  appModeDark?: boolean;
  taxRate?: number;
  vatRate?: number;
  serviceRate?: number;
};

export type StoreMember = {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  role: "admin" | "manager" | "cashier";
  joinedAt: string;
};

export type InviteRole = "admin" | "manager" | "cashier";

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export type PendingInvite = {
  id: string;
  email: string;
  role: InviteRole;
  status: InviteStatus;
  sentAt: string;
  expiresAt: string | null;
};

export type SendInviteInput = {
  email: string;
  role: InviteRole;
  resend?: boolean;
};

export type SendInviteResult = {
  invite: PendingInvite;
  emailSent: boolean;
  warning?: string;
};

export type AddUserInput = {
  name: string;
  email: string;
  password: string;
  role: InviteRole;
};

export type AddUserResult = {
  member: StoreMember;
};
