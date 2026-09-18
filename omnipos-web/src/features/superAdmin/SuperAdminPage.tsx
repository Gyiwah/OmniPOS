import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Cpu,
  Database,
  LayoutDashboard,
  Store,
  Users,
} from "lucide-react";

import { api } from "@/api/client";
import {
  EmptyState,
  PlatformDenied,
  PlatformPage,
  usePlatformAccess,
} from "./PlatformChrome";
import { PLATFORM_GROUPS } from "./platformNav";

type PlatformDashboard = {
  stores: { total: number; active: number; inactive: number; branches: number };
  users: { total: number; active: number; super_admins: number };
  devices: { total: number; online: number };
  sync: { pending: number; failed: number };
  audit_events_today: number;
};

export function SuperAdminPage() {
  const isSuperAdmin = usePlatformAccess();
  const dashboard = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => api.get<PlatformDashboard>("/api/admin/dashboard", undefined, { storeless: true }),
    enabled: isSuperAdmin,
  });

  if (!isSuperAdmin) return <PlatformDenied title="Platform" />;

  const data = dashboard.data;

  return (
    <PlatformPage
      icon={LayoutDashboard}
      title="Control center"
      description="Operate tenants, billing, devices, and governance from one place. Store tills keep day-to-day selling."
    >
      <section className="platform-kpi-grid">
        <Kpi to="/platform/stores" icon={Store} label="Stores" value={data?.stores.total ?? "—"} hint={`${data?.stores.active ?? 0} active · ${data?.stores.inactive ?? 0} paused`} />
        <Kpi to="/platform/branches" icon={Activity} label="Branches" value={data?.stores.branches ?? "—"} hint="Linked to parent stores" />
        <Kpi to="/platform/people" icon={Users} label="People" value={data?.users.total ?? "—"} hint={`${data?.users.super_admins ?? 0} platform admins`} />
        <Kpi to="/platform/devices" icon={Cpu} label="Devices online" value={data ? `${data.devices.online}/${data.devices.total}` : "—"} hint="Seen in the last 15 minutes" />
        <Kpi to="/platform/synchronization" icon={Database} label="Sync pressure" value={data?.sync.failed ?? "—"} hint={`${data?.sync.pending ?? 0} pending · ${data?.audit_events_today ?? 0} audits today`} />
      </section>

      {dashboard.isLoading && <p className="muted">Loading platform health…</p>}
      {dashboard.error && (
        <p className="notice notice-warn">
          {dashboard.error instanceof Error ? dashboard.error.message : "Could not load the dashboard."}
        </p>
      )}

      <div className="platform-module-grid">
        {PLATFORM_GROUPS.flatMap((group) => group.items)
          .filter((item) => item.to !== "/platform")
          .map((item) => {
            const Icon = item.icon;
            return (
              <Link className="platform-module-card" to={item.to} key={item.to}>
                <span className="platform-module-icon"><Icon size={18} aria-hidden="true" /></span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            );
          })}
      </div>

      {!dashboard.isLoading && !data && (
        <EmptyState title="No metrics yet" hint="Once stores are provisioned, this dashboard fills with live counts." />
      )}
    </PlatformPage>
  );
}

function Kpi({
  to,
  icon: Icon,
  label,
  value,
  hint,
}: {
  to: string;
  icon: typeof Store;
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <Link className="platform-kpi platform-kpi-link" to={to}>
      <span><Icon size={17} aria-hidden="true" />{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </Link>
  );
}
