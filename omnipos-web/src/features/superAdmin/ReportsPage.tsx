import { useQuery } from "@tanstack/react-query";
import { BarChart3, ShieldCheck } from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";

type PlatformDashboard = {
  stores: { total: number; active: number; inactive: number; branches: number };
  users: { total: number; active: number; super_admins: number };
  devices: { total: number; online: number };
  sync: { pending: number; failed: number };
  audit_events_today: number;
};

type SystemStore = {
  id: string;
  name: string;
  platform_status: "active" | "suspended" | "inactive";
  parent_store_id: string | null;
  members_count: number;
  orders_count: number;
};

type PlatformPerson = {
  id: string;
  name: string;
  email: string;
  is_super_admin: boolean;
  active: boolean;
  stores_count: number;
};

type PlatformDevice = {
  id: string;
  platform: string;
  terminal_label: string | null;
  platform_status: string;
  last_seen_at: string | null;
  store: { name: string } | null;
};

type PlatformSubscription = {
  id: string;
  status: string;
  store: { name: string; platform_status: string } | null;
  plan: { name: string; monthly_price: string } | null;
};

export function PlatformReportsPage() {
  const isSuperAdmin = useSession((s) => s.user?.is_super_admin ?? false);

  const dashboard = useQuery({
    queryKey: ["platform-reports-dashboard"],
    queryFn: () => api.get<PlatformDashboard>("/api/admin/dashboard", undefined, { storeless: true }),
    enabled: isSuperAdmin,
  });

  const stores = useQuery({
    queryKey: ["platform-reports-stores"],
    queryFn: async () => (await api.get<{ data: SystemStore[] }>("/api/admin/stores", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const people = useQuery({
    queryKey: ["platform-reports-people"],
    queryFn: async () => (await api.get<{ data: PlatformPerson[] }>("/api/admin/users", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const devices = useQuery({
    queryKey: ["platform-reports-devices"],
    queryFn: async () => (await api.get<{ data: PlatformDevice[] }>("/api/admin/devices", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const subscriptions = useQuery({
    queryKey: ["platform-reports-subscriptions"],
    queryFn: async () => (await api.get<{ data: PlatformSubscription[] }>("/api/admin/subscriptions", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  if (!isSuperAdmin) {
    return (<div className="page"><h1><ShieldCheck size={20} /> Reports</h1><p className="notice notice-warn">This area is limited to platform administrators.</p></div>);
  }

  const healthyStores = (stores.data ?? []).filter((store) => store.platform_status === "active").length;
  const activePeople = (people.data ?? []).filter((person) => person.active).length;
  const onlineDevices = (devices.data ?? []).filter((device) => device.platform_status === "active" && device.last_seen_at).length;
  const activeSubscriptions = (subscriptions.data ?? []).filter((item) => item.status === "active").length;

  return (
    <div className="page platform-page">
      <header className="page-header">
        <div>
          <h1><BarChart3 size={20} /> Reports</h1>
          <p className="muted">Platform governance summaries for stores, membership, devices, and subscription health.</p>
        </div>
        <span className="platform-scope-badge"><ShieldCheck size={14} /> Platform only</span>
      </header>

      <section className="platform-kpi-grid">
        <PlatformKpi label="Stores" value={dashboard.data?.stores.total ?? stores.data?.length ?? 0} hint={`${healthyStores} active`} />
        <PlatformKpi label="Branches" value={dashboard.data?.stores.branches ?? (stores.data ?? []).filter((store) => store.parent_store_id).length} hint={`${dashboard.data?.stores.inactive ?? 0} inactive`} />
        <PlatformKpi label="People" value={dashboard.data?.users.total ?? people.data?.length ?? 0} hint={`${activePeople} active`} />
        <PlatformKpi label="Devices" value={dashboard.data?.devices.total ?? devices.data?.length ?? 0} hint={`${onlineDevices} online`} />
        <PlatformKpi label="Audit events" value={dashboard.data?.audit_events_today ?? 0} hint={`${dashboard.data?.sync.failed ?? 0} sync failures`} />
      </section>

      <div className="platform-two-column">
        <section className="platform-panel">
          <div className="platform-section-heading"><div><h2>Platform health</h2><p>Current operating status across the installation.</p></div></div>
          <div className="platform-resource-list">
            <div className="platform-resource-row"><span><strong>Active stores</strong><small>Total operational stores</small></span><b>{dashboard.data?.stores.active ?? healthyStores}</b></div>
            <div className="platform-resource-row"><span><strong>Inactive/suspended stores</strong><small>Non-active platforms</small></span><b>{dashboard.data?.stores.inactive ?? (stores.data ?? []).filter((store) => store.platform_status !== "active").length}</b></div>
            <div className="platform-resource-row"><span><strong>Super admins</strong><small>Platform-level operators</small></span><b>{dashboard.data?.users.super_admins ?? (people.data ?? []).filter((person) => person.is_super_admin).length}</b></div>
            <div className="platform-resource-row"><span><strong>Pending sync</strong><small>Queued operations</small></span><b>{dashboard.data?.sync.pending ?? 0}</b></div>
            <div className="platform-resource-row"><span><strong>Open conflicts</strong><small>Reconciliation backlog</small></span><b>{dashboard.data?.sync.failed ?? 0}</b></div>
          </div>
        </section>

        <section className="platform-panel">
          <div className="platform-section-heading"><div><h2>Subscription coverage</h2><p>Store plans and current coverage.</p></div></div>
          <div className="platform-resource-list">
            <div className="platform-resource-row"><span><strong>Active subscriptions</strong><small>Stores on an active plan</small></span><b>{activeSubscriptions}</b></div>
            <div className="platform-resource-row"><span><strong>Stores without plan</strong><small>Unassigned or inactive</small></span><b>{Math.max((stores.data ?? []).length - activeSubscriptions, 0)}</b></div>
            <div className="platform-resource-row"><span><strong>Most common status</strong><small>Current platform pattern</small></span><b>{(subscriptions.data ?? []).length > 0 ? "Active" : "None"}</b></div>
          </div>
        </section>
      </div>
    </div>
  );
}

function PlatformKpi({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="platform-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}
