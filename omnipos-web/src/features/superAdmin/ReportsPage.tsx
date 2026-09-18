import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";

import { api } from "@/api/client";
import { PlatformDenied, PlatformPage, usePlatformAccess } from "./PlatformChrome";

type PlatformDashboard = {
  stores: { total: number; active: number; inactive: number; branches: number };
  users: { total: number; active: number; super_admins: number };
  devices: { total: number; online: number };
  sync: { pending: number; failed: number };
  audit_events_today: number;
};

type SystemStore = {
  id: string;
  platform_status: "active" | "suspended" | "inactive";
  parent_store_id: string | null;
};

type PlatformPerson = { id: string; is_super_admin: boolean; active: boolean };
type PlatformSubscription = { id: string; status: string };

export function PlatformReportsPage() {
  const isSuperAdmin = usePlatformAccess();

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
  const subscriptions = useQuery({
    queryKey: ["platform-reports-subscriptions"],
    queryFn: async () => (await api.get<{ data: PlatformSubscription[] }>("/api/admin/subscriptions", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  if (!isSuperAdmin) return <PlatformDenied title="Reports" />;

  const healthyStores = (stores.data ?? []).filter((store) => store.platform_status === "active").length;
  const activePeople = (people.data ?? []).filter((person) => person.active).length;
  const activeSubscriptions = (subscriptions.data ?? []).filter((item) => item.status === "active").length;

  return (
    <PlatformPage
      icon={BarChart3}
      title="Reports"
      description="Governance summaries across tenants. Open a module when you need to act on a number."
    >
      <section className="platform-kpi-grid">
        <div className="platform-kpi"><span>Stores</span><strong>{dashboard.data?.stores.total ?? stores.data?.length ?? 0}</strong><small>{healthyStores} active</small></div>
        <div className="platform-kpi"><span>Branches</span><strong>{dashboard.data?.stores.branches ?? (stores.data ?? []).filter((store) => store.parent_store_id).length}</strong><small>{dashboard.data?.stores.inactive ?? 0} paused</small></div>
        <div className="platform-kpi"><span>People</span><strong>{dashboard.data?.users.total ?? people.data?.length ?? 0}</strong><small>{activePeople} active</small></div>
        <div className="platform-kpi"><span>Devices</span><strong>{dashboard.data?.devices.total ?? 0}</strong><small>{dashboard.data?.devices.online ?? 0} online</small></div>
        <div className="platform-kpi"><span>Audit today</span><strong>{dashboard.data?.audit_events_today ?? 0}</strong><small>{dashboard.data?.sync.failed ?? 0} sync failures</small></div>
      </section>

      <div className="platform-two-column">
        <section className="platform-panel">
          <div className="platform-section-heading"><div><h2>Estate health</h2><p>Current operating status.</p></div></div>
          <div className="platform-resource-list">
            <Link className="platform-resource-row" to="/platform/stores"><span><strong>Active stores</strong><small>Operational tenants</small></span><b>{dashboard.data?.stores.active ?? healthyStores}</b></Link>
            <Link className="platform-resource-row" to="/platform/stores"><span><strong>Paused stores</strong><small>Suspended or inactive</small></span><b>{dashboard.data?.stores.inactive ?? (stores.data ?? []).filter((store) => store.platform_status !== "active").length}</b></Link>
            <Link className="platform-resource-row" to="/platform/people"><span><strong>Super admins</strong><small>Platform operators</small></span><b>{dashboard.data?.users.super_admins ?? (people.data ?? []).filter((person) => person.is_super_admin).length}</b></Link>
            <Link className="platform-resource-row" to="/platform/synchronization"><span><strong>Pending sync</strong><small>Queued operations</small></span><b>{dashboard.data?.sync.pending ?? 0}</b></Link>
          </div>
        </section>
        <section className="platform-panel">
          <div className="platform-section-heading"><div><h2>Commercial coverage</h2><p>Plan assignment across stores.</p></div></div>
          <div className="platform-resource-list">
            <Link className="platform-resource-row" to="/platform/subscriptions"><span><strong>Active subscriptions</strong><small>Stores on a live plan</small></span><b>{activeSubscriptions}</b></Link>
            <Link className="platform-resource-row" to="/platform/subscriptions"><span><strong>Stores without a plan</strong><small>Unassigned or inactive</small></span><b>{Math.max((stores.data ?? []).length - activeSubscriptions, 0)}</b></Link>
            <Link className="platform-resource-row" to="/platform/audit-logs"><span><strong>Audit events today</strong><small>Governance trail</small></span><b>{dashboard.data?.audit_events_today ?? 0}</b></Link>
          </div>
        </section>
      </div>
    </PlatformPage>
  );
}
