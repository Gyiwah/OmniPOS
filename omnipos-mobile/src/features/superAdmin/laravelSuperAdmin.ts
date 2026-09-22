import { api } from "@/src/core/api/client";
import type {
  CreateGlobalCategoryInput,
  CreatePersonInput,
  CreatePlanInput,
  GlobalCategory,
  PlatformAuditLog,
  PlatformBranch,
  PlatformDashboard,
  PlatformDevice,
  PlatformPerson,
  PlatformPlan,
  PlatformResources,
  PlatformStore,
  PlatformSync,
  ProvisionStoreInput,
  StoreMemberDetail,
  SystemStore,
  UpdateGlobalCategoryInput,
  UpdatePersonInput,
  UpdatePlanInput,
  UpdateStoreInput,
} from "./types";

type StoreRow = {
  id: string;
  name: string;
  currency?: string;
  timezone?: string;
  tax_profile?: string;
  language?: string;
  members_count?: number;
  orders_count?: number;
  owner?: { id: string; name: string; email: string } | null;
  created_at?: string | null;
  platform_status?: "active" | "suspended" | "inactive";
  parent_store_id?: string | null;
};

function mapStore(row: StoreRow): PlatformStore {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency ?? "USD",
    timezone: row.timezone ?? "UTC",
    taxProfile: row.tax_profile ?? "standard",
    ownerUserId: row.owner?.id ?? "",
    createdAt: row.created_at ?? "",
    ownerName: row.owner?.name ?? "",
    ownerEmail: row.owner?.email ?? "",
    status: row.platform_status ?? "active",
    parentStoreId: row.parent_store_id ?? null,
    membersCount: row.members_count ?? 0,
    ordersCount: row.orders_count ?? 0,
  };
}

export const laravelSuperAdminService = {
  async dashboard(): Promise<PlatformDashboard> {
    const res = await api.get<{
      stores: PlatformDashboard["stores"];
      users: { total: number; active: number; super_admins: number };
      devices: PlatformDashboard["devices"];
      sync: PlatformDashboard["sync"];
      audit_events_today: number;
    }>("/api/admin/dashboard", undefined, { storeless: true });
    return {
      stores: res.stores,
      users: { ...res.users, superAdmins: res.users.super_admins },
      devices: res.devices,
      sync: res.sync,
      auditEventsToday: res.audit_events_today,
    };
  },

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

  async listPlatformStores(): Promise<PlatformStore[]> {
    const res = await api.get<{ data: StoreRow[] }>("/api/admin/stores", undefined, { storeless: true });
    return (res.data ?? []).map(mapStore);
  },

  async updateStore(storeId: string, input: UpdateStoreInput): Promise<PlatformStore> {
    const res = await api.patch<{ store: StoreRow }>(
      `/api/admin/stores/${storeId}`,
      {
        name: input.name,
        currency: input.currency,
        timezone: input.timezone,
        tax_profile: input.taxProfile,
        language: input.language,
        platform_status: input.status,
      },
      { storeless: true },
    );
    return mapStore(res.store);
  },

  async updateStoreStatus(storeId: string, status: PlatformStore["status"]): Promise<void> {
    await api.patch(`/api/admin/stores/${storeId}/status`, { status }, { storeless: true });
  },

  async deleteStore(storeId: string): Promise<void> {
    await api.delete(`/api/admin/stores/${storeId}`, { storeless: true });
  },

  async getStoreMembers(storeId: string): Promise<StoreMemberDetail[]> {
    const res = await api.get<{
      data: Array<{
        id: string;
        role: "admin" | "manager" | "cashier";
        user: { id?: string; name: string; email: string } | null;
      }>;
    }>(`/api/admin/stores/${storeId}/members`, undefined, { storeless: true });
    return res.data ?? [];
  },

  async listBranches(): Promise<PlatformBranch[]> {
    const res = await api.get<{ data: Array<StoreRow & { parent_store?: { id: string; name: string } | null }> }>(
      "/api/admin/branches",
      undefined,
      { storeless: true },
    );
    return (res.data ?? []).map((row) => ({ ...mapStore(row), parentStoreName: row.parent_store?.name ?? null }));
  },

  async createBranch(input: { name: string; parentStoreId: string; currency?: string; timezone?: string }) {
    const res = await api.post<{ branch: StoreRow }>(
      "/api/admin/branches",
      { name: input.name, parent_store_id: input.parentStoreId, currency: input.currency, timezone: input.timezone },
      { storeless: true },
    );
    return mapStore(res.branch);
  },

  async deleteBranch(branchId: string): Promise<void> {
    await api.delete(`/api/admin/branches/${branchId}`, { storeless: true });
  },

  async updateBranch(branchId: string, input: { name?: string; status?: PlatformBranch["status"] }) {
    const res = await api.patch<{ branch: StoreRow }>(
      `/api/admin/branches/${branchId}`,
      {
        name: input.name,
        platform_status: input.status,
      },
      { storeless: true },
    );
    return mapStore(res.branch);
  },

  async listPeople(): Promise<PlatformPerson[]> {
    const res = await api.get<{
      data: Array<{
        id: string;
        name: string;
        email: string;
        is_super_admin: boolean;
        active: boolean;
        member_stores: Array<{ store_id: string; store_name: string | null; role: "admin" | "manager" | "cashier" }>;
      }>;
    }>("/api/admin/people", undefined, { storeless: true });
    return (res.data ?? []).map((person) => ({
      id: person.id,
      name: person.name,
      email: person.email,
      isSuperAdmin: person.is_super_admin,
      active: person.active,
      memberStores: person.member_stores.map((member) => ({
        storeId: member.store_id,
        storeName: member.store_name,
        role: member.role,
      })),
    }));
  },

  async createPerson(input: CreatePersonInput): Promise<PlatformPerson> {
    const res = await api.post<{
      person: {
        id: string;
        name: string;
        email: string;
        is_super_admin: boolean;
        active: boolean;
        member_stores: Array<{ store_id: string; store_name: string | null; role: "admin" | "manager" | "cashier" }>;
      };
    }>(
      "/api/admin/people",
      {
        name: input.name,
        email: input.email,
        password: input.password,
        is_super_admin: input.isSuperAdmin,
        store_id: input.storeId,
        role: input.role,
      },
      { storeless: true },
    );
    const p = res.person;
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      isSuperAdmin: p.is_super_admin,
      active: p.active,
      memberStores: (p.member_stores ?? []).map((m) => ({
        storeId: m.store_id,
        storeName: m.store_name,
        role: m.role,
      })),
    };
  },

  async updateStoreMembershipRole(userId: string, storeId: string, role: string): Promise<void> {
    await api.patch(`/api/admin/people/${userId}/stores/${storeId}`, { role }, { storeless: true });
  },

  async setPlatformAdmin(userId: string, isSuperAdmin: boolean): Promise<void> {
    await api.patch(`/api/admin/people/${userId}/platform-admin`, { is_super_admin: isSuperAdmin }, { storeless: true });
  },

  async updatePerson(userId: string, input: UpdatePersonInput): Promise<void> {
    await api.patch(
      `/api/admin/people/${userId}`,
      {
        name: input.name,
        email: input.email,
        password: input.password || undefined,
        is_super_admin: input.isSuperAdmin,
        store_id: input.storeId || undefined,
        role: input.storeId ? input.role : undefined,
      },
      { storeless: true },
    );
  },

  async deletePerson(userId: string): Promise<void> {
    await api.delete(`/api/admin/people/${userId}`, { storeless: true });
  },

  async listDevices(): Promise<PlatformDevice[]> {
    const res = await api.get<{
      data: Array<{
        id: string;
        platform: string;
        terminal_label: string | null;
        app_version: string | null;
        platform_status: PlatformDevice["status"];
        last_seen_at: string | null;
        store: { name: string } | null;
        user: { name: string } | null;
      }>;
    }>("/api/admin/devices", undefined, { storeless: true });
    return (res.data ?? []).map((device) => ({
      id: device.id,
      platform: device.platform,
      terminalLabel: device.terminal_label,
      appVersion: device.app_version,
      status: device.platform_status,
      lastSeenAt: device.last_seen_at,
      storeName: device.store?.name ?? null,
      userName: device.user?.name ?? null,
    }));
  },

  async updateDeviceStatus(deviceId: string, status: PlatformDevice["status"]): Promise<void> {
    await api.patch(`/api/admin/devices/${deviceId}/status`, { status }, { storeless: true });
  },

  async syncMonitor(): Promise<PlatformSync> {
    const res = await api.get<{
      summary: {
        stores_online: number;
        stores_total: number;
        devices_online: number;
        devices_total: number;
        pending_operations: number;
        failed_operations: number;
        open_conflicts: number;
      };
      recent_failures: Array<{
        operation_id: string;
        status: string;
        store: string | null;
        device: string | null;
        entity: string;
        record_id?: string;
        error: string | null;
        created_at: string;
      }>;
    }>("/api/admin/sync-monitor", undefined, { storeless: true });
    return {
      summary: {
        storesOnline: res.summary.stores_online,
        storesTotal: res.summary.stores_total,
        devicesOnline: res.summary.devices_online,
        devicesTotal: res.summary.devices_total,
        pendingOperations: res.summary.pending_operations,
        failedOperations: res.summary.failed_operations,
        openConflicts: res.summary.open_conflicts,
      },
      recentFailures: res.recent_failures.map((failure) => ({
        operationId: failure.operation_id,
        status: failure.status,
        store: failure.store,
        device: failure.device,
        entity: failure.entity,
        recordId: failure.record_id,
        error: failure.error,
        createdAt: failure.created_at,
      })),
    };
  },

  async auditLogs(filter?: { action?: string; storeId?: string }): Promise<PlatformAuditLog[]> {
    const query: Record<string, string> = {};
    if (filter?.action) query.action = filter.action;
    if (filter?.storeId) query.store_id = filter.storeId;

    const res = await api.get<{
      data: Array<{
        id: string;
        action: string;
        entity_type: string | null;
        entity_id: string | null;
        store_id: string | null;
        user: { name: string } | null;
        before: unknown;
        after: unknown;
        ip_address: string | null;
        created_at: string;
      }>;
    }>("/api/admin/audit-logs", query, { storeless: true });
    return (res.data ?? []).map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entity_type,
      entityId: log.entity_id,
      storeId: log.store_id,
      actorName: log.user?.name ?? null,
      before: log.before,
      after: log.after,
      ipAddress: log.ip_address,
      createdAt: log.created_at,
    }));
  },

  async resources(): Promise<PlatformResources> {
    const res = await api.get<{ categories: GlobalCategory[]; settings: PlatformResources["settings"] }>(
      "/api/admin/system-resources",
      undefined,
      { storeless: true },
    );
    return res;
  },

  async billing(): Promise<{
    plans: PlatformPlan[];
    subscriptions: Array<{
      id: string;
      status: string;
      storeId: string | null;
      storeName: string | null;
      planId: string | null;
      planName: string | null;
      monthlyPrice: number | null;
    }>;
  }> {
    const [plansRes, subscriptionsRes] = await Promise.all([
      api.get<{
        data: Array<{
          id: string;
          name: string;
          slug: string;
          description?: string | null;
          monthly_price: number;
          limits?: Record<string, unknown> | null;
          platform_status: string;
          subscriptions_count: number;
        }>;
      }>("/api/admin/plans", undefined, { storeless: true }),
      api.get<{
        data: Array<{
          id: string;
          status: string;
          store: { id: string; name: string } | null;
          plan: { id: string; name: string; monthly_price: number } | null;
        }>;
      }>("/api/admin/subscriptions", undefined, { storeless: true }),
    ]);
    return {
      plans: (plansRes.data ?? []).map((plan) => ({
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        description: plan.description,
        monthlyPrice: Number(plan.monthly_price),
        limits: plan.limits,
        status: plan.platform_status,
        subscriptionsCount: plan.subscriptions_count,
      })),
      subscriptions: (subscriptionsRes.data ?? []).map((subscription) => ({
        id: subscription.id,
        status: subscription.status,
        storeId: subscription.store?.id ?? null,
        storeName: subscription.store?.name ?? null,
        planId: subscription.plan?.id ?? null,
        planName: subscription.plan?.name ?? null,
        monthlyPrice: subscription.plan ? Number(subscription.plan.monthly_price) : null,
      })),
    };
  },

  async createPlan(input: CreatePlanInput): Promise<PlatformPlan> {
    const res = await api.post<{
      plan: {
        id: string;
        name: string;
        slug: string;
        description: string | null;
        monthly_price: number;
        limits: Record<string, unknown> | null;
        platform_status: string;
        subscriptions_count?: number;
      };
    }>("/api/admin/plans", {
      name: input.name,
      slug: input.slug,
      description: input.description,
      monthly_price: input.monthlyPrice,
      limits: input.limits,
    }, { storeless: true });
    return {
      id: res.plan.id,
      name: res.plan.name,
      slug: res.plan.slug,
      description: res.plan.description,
      monthlyPrice: Number(res.plan.monthly_price),
      limits: res.plan.limits,
      status: res.plan.platform_status,
      subscriptionsCount: res.plan.subscriptions_count ?? 0,
    };
  },

  async updatePlan(planId: string, input: UpdatePlanInput): Promise<void> {
    await api.patch(
      `/api/admin/plans/${planId}`,
      {
        name: input.name,
        slug: input.slug,
        description: input.description,
        monthly_price: input.monthlyPrice,
        limits: input.limits,
        platform_status: input.status,
      },
      { storeless: true },
    );
  },

  async deletePlan(planId: string): Promise<void> {
    await api.delete(`/api/admin/plans/${planId}`, { storeless: true });
  },

  async assignSubscription(storeId: string, planId: string, status: "active" | "suspended" | "expired" = "active") {
    await api.post(`/api/admin/stores/${storeId}/subscription`, { plan_id: planId, status }, { storeless: true });
  },

  async createGlobalCategory(input: CreateGlobalCategoryInput): Promise<void> {
    await api.post("/api/admin/system-resources/categories", input, { storeless: true });
  },

  async updateGlobalCategory(categoryId: string, input: UpdateGlobalCategoryInput): Promise<void> {
    await api.patch(`/api/admin/system-resources/categories/${categoryId}`, input, { storeless: true });
  },

  async deleteGlobalCategory(categoryId: string): Promise<void> {
    await api.delete(`/api/admin/system-resources/categories/${categoryId}`, { storeless: true });
  },

  async updateSystemSetting(key: string, value: Record<string, unknown>, description?: string): Promise<void> {
    await api.patch(
      `/api/admin/system-resources/settings/${encodeURIComponent(key)}`,
      { value, description },
      { storeless: true },
    );
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
        parent_store_id: input.parentStoreId || undefined,
        admin_email: input.adminEmail,
        admin_name: input.adminFullName,
        admin_password: input.adminPassword || undefined,
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
      accountCreated: res.account_created,
    };
  },
};
