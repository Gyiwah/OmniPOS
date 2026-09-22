export type SystemStore = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  taxProfile: string;
  ownerUserId: string;
  createdAt: string;
  ownerName?: string;
  ownerEmail?: string;
};

export type ProvisionStoreInput = {
  storeName: string;
  currency?: string;
  timezone?: string;
  taxProfile?: string;
  adminFullName: string;
  adminEmail: string;
  adminPassword?: string;
  parentStoreId?: string;
};

export type PlatformDashboard = {
  stores: { total: number; active: number; inactive: number; branches: number };
  users: { total: number; active: number; superAdmins: number };
  devices: { total: number; online: number };
  sync: { pending: number; failed: number };
  auditEventsToday: number;
};

export type PlatformStore = SystemStore & {
  status: "active" | "suspended" | "inactive";
  parentStoreId: string | null;
  membersCount: number;
  ordersCount: number;
};

export type UpdateStoreInput = {
  name?: string;
  currency?: string;
  timezone?: string;
  taxProfile?: string;
  language?: string;
  status?: PlatformStore["status"];
};

export type PlatformBranch = PlatformStore & {
  parentStoreName: string | null;
};

export type PlatformPerson = {
  id: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  active: boolean;
  memberStores: Array<{ storeId: string; storeName: string | null; role: "admin" | "manager" | "cashier" }>;
};

export type StoreMemberDetail = {
  id: string;
  role: "admin" | "manager" | "cashier";
  user: { id?: string; name: string; email: string } | null;
};

export type CreatePersonInput = {
  name: string;
  email: string;
  password: string;
  isSuperAdmin?: boolean;
  storeId?: string;
  role?: "admin" | "manager" | "cashier";
};

export type UpdatePersonInput = {
  name?: string;
  email?: string;
  password?: string;
  isSuperAdmin?: boolean;
  storeId?: string;
  role?: "admin" | "manager" | "cashier";
};

export type PlatformDevice = {
  id: string;
  platform: string;
  terminalLabel: string | null;
  appVersion: string | null;
  status: "active" | "revoked" | "inactive";
  lastSeenAt: string | null;
  storeName: string | null;
  userName: string | null;
};

export type SyncFailure = {
  operationId: string;
  status: string;
  store: string | null;
  device: string | null;
  entity: string;
  recordId?: string;
  error: string | null;
  createdAt: string;
};

export type PlatformSync = {
  summary: {
    storesOnline: number;
    storesTotal: number;
    devicesOnline: number;
    devicesTotal: number;
    pendingOperations: number;
    failedOperations: number;
    openConflicts: number;
  };
  recentFailures: SyncFailure[];
};

export type PlatformAuditLog = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  storeId: string | null;
  actorName: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  createdAt: string;
};

export type GlobalCategory = {
  id: string;
  name: string;
  slug: string;
  status: string;
  position: number;
};

export type CreateGlobalCategoryInput = {
  name: string;
  slug: string;
  position?: number;
};

export type UpdateGlobalCategoryInput = {
  name?: string;
  slug?: string;
  position?: number;
  status?: "active" | "inactive";
};

export type PlatformSetting = {
  key: string;
  value: Record<string, unknown> | null;
  description: string | null;
};

export type PlatformResources = {
  categories: GlobalCategory[];
  settings: PlatformSetting[];
};

export type PlatformPlan = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  monthlyPrice: number;
  limits?: Record<string, unknown> | null;
  status: string;
  subscriptionsCount: number;
};

export type CreatePlanInput = {
  name: string;
  slug: string;
  description?: string;
  monthlyPrice: number;
  limits?: Record<string, unknown>;
};

export type UpdatePlanInput = {
  name?: string;
  slug?: string;
  description?: string;
  monthlyPrice?: number;
  limits?: Record<string, unknown>;
  status?: string;
};

export type PlatformSubscriptionDetail = {
  id: string;
  status: string;
  startsAt?: string | null;
  endsAt?: string | null;
  storeId: string | null;
  storeName: string | null;
  planId: string | null;
  planName: string | null;
  monthlyPrice: number | null;
};
