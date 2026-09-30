import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Database,
  GitBranch,
  Monitor,
  Printer,
  RefreshCw,
  ShieldCheck,
  Store,
  Users,
} from "lucide-react";

import { api } from "@/api/client";
import { printTableAsPdf } from "@/utils/printTable";
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
  name?: string;
  platform_status: "active" | "suspended" | "inactive";
  parent_store_id: string | null;
};

type PlatformPerson = {
  id: string;
  name?: string;
  email?: string;
  is_super_admin: boolean;
  active: boolean;
};

type PlatformSubscription = {
  id: string;
  status: string;
  store?: { id: string; name: string } | null;
  plan?: { id: string; name: string } | null;
};

export function PlatformReportsPage() {
  const isSuperAdmin = usePlatformAccess();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const dashboard = useQuery({
    queryKey: ["platform-reports-dashboard"],
    queryFn: () => api.get<PlatformDashboard>("/api/admin/dashboard", undefined, { storeless: true }),
    enabled: isSuperAdmin,
  });

  const stores = useQuery({
    queryKey: ["platform-reports-stores"],
    queryFn: async () =>
      (await api.get<{ data: SystemStore[] }>("/api/admin/stores", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const people = useQuery({
    queryKey: ["platform-reports-people"],
    queryFn: async () =>
      (await api.get<{ data: PlatformPerson[] }>("/api/admin/users", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const subscriptions = useQuery({
    queryKey: ["platform-reports-subscriptions"],
    queryFn: async () =>
      (await api.get<{ data: PlatformSubscription[] }>("/api/admin/subscriptions", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  if (!isSuperAdmin) return <PlatformDenied title="Reports" />;

  const storeList = stores.data ?? [];
  const peopleList = people.data ?? [];
  const subscriptionList = subscriptions.data ?? [];
  const dash = dashboard.data;

  const totalStores = dash?.stores.total ?? storeList.length;
  const healthyStores = dash?.stores.active ?? storeList.filter((s) => s.platform_status === "active").length;
  const pausedStores = dash?.stores.inactive ?? storeList.filter((s) => s.platform_status !== "active").length;
  const branchCount = dash?.stores.branches ?? storeList.filter((s) => s.parent_store_id !== null).length;
  const independentStores = Math.max(totalStores - branchCount, 0);

  const totalUsers = dash?.users.total ?? peopleList.length;
  const activeUsers = dash?.users.active ?? peopleList.filter((p) => p.active).length;
  const superAdminCount = dash?.users.super_admins ?? peopleList.filter((p) => p.is_super_admin).length;

  const totalDevices = dash?.devices.total ?? 0;
  const onlineDevices = dash?.devices.online ?? 0;
  const deviceOnlineRate = totalDevices > 0 ? Math.round((onlineDevices / totalDevices) * 100) : 100;

  const activeSubs = subscriptionList.filter((sub) => sub.status === "active").length;
  const unassignedStores = Math.max(totalStores - activeSubs, 0);
  const subAdoptionRate = totalStores > 0 ? Math.round((activeSubs / totalStores) * 100) : 0;
  const storeHealthRate = totalStores > 0 ? Math.round((healthyStores / totalStores) * 100) : 100;

  const pendingSync = dash?.sync.pending ?? 0;
  const failedSync = dash?.sync.failed ?? 0;
  const auditToday = dash?.audit_events_today ?? 0;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      dashboard.refetch(),
      stores.refetch(),
      people.refetch(),
      subscriptions.refetch(),
    ]);
    setIsRefreshing(false);
  };

  const handleExportPdf = () => {
    printTableAsPdf({
      title: "OmniPOS Platform Governance & Executive Health Report",
      columns: ["Governance Domain", "Key Metric", "Current Metric Value", "Health / Operational Status"],
      rows: [
        ["Tenants & Stores", "Total Registered Tenants", `${totalStores}`, "Baseline"],
        ["Tenants & Stores", "Active Operational Stores", `${healthyStores} (${storeHealthRate}%)`, healthyStores === totalStores ? "Nominal" : "Attention"],
        ["Tenants & Stores", "Paused / Suspended Stores", `${pausedStores}`, pausedStores > 0 ? "Review Required" : "Zero paused"],
        ["Tenants & Stores", "Multi-Branch Network", `${branchCount} branches across ${independentStores} parent stores`, "Nominal"],
        ["Platform Access", "Total Platform Users", `${totalUsers}`, "Nominal"],
        ["Platform Access", "Active Operational Users", `${activeUsers}`, "Nominal"],
        ["Platform Access", "Platform Super Admins", `${superAdminCount}`, "Elevated Access"],
        ["Hardware & Terminals", "Registered POS Terminals", `${totalDevices}`, "Nominal"],
        ["Hardware & Terminals", "Active Online Terminals", `${onlineDevices} (${deviceOnlineRate}% online)`, onlineDevices > 0 ? "Connected" : "Idle"],
        ["Commercial Subscriptions", "Active Store Subscriptions", `${activeSubs} (${subAdoptionRate}% coverage)`, activeSubs > 0 ? "Active Billing" : "No Subscriptions"],
        ["Commercial Subscriptions", "Unassigned Stores", `${unassignedStores}`, unassignedStores > 0 ? "Onboarding Pending" : "100% Covered"],
        ["Sync Engine & Integrity", "Queued / Pending Operations", `${pendingSync}`, pendingSync === 0 ? "Healthy Queue" : "Processing"],
        ["Sync Engine & Integrity", "Sync Failures / Conflicts", `${failedSync}`, failedSync === 0 ? "Zero Errors" : "Attention Required"],
        ["Compliance & Security", "Audit Events Recorded Today", `${auditToday}`, "Immutable Logging Active"],
      ],
    });
  };

  return (
    <PlatformPage
      icon={BarChart3}
      title="Platform Reports & Governance"
      description="Executive multi-tenant metrics, terminal connectivity telemetry, subscription health, and platform governance logs."
      actions={
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            className="secondary-button"
            onClick={handleExportPdf}
            title="Export executive governance summary as printable PDF"
          >
            <Printer size={15} aria-hidden="true" />
            <span>Export Report (PDF)</span>
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            title="Refresh platform telemetry"
          >
            <RefreshCw size={15} className={isRefreshing ? "spin-icon" : ""} aria-hidden="true" />
            <span>{isRefreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      }
    >
      {/* Platform Executive Bento KPI Grid */}
      <section className="platform-kpi-bento">
        <Link className="platform-kpi-card" to="/platform/stores">
          <div className="platform-kpi-header">
            <span className="platform-kpi-title">
              <Store size={15} aria-hidden="true" /> Managed Stores
            </span>
            <span className="platform-kpi-icon-wrap">
              <ArrowUpRight size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="platform-kpi-value">{totalStores}</div>
          <div className="platform-kpi-footer">
            <span>{healthyStores} active operational</span>
            <span className={`platform-kpi-badge ${pausedStores === 0 ? "badge-ok" : "badge-warn"}`}>
              {storeHealthRate}% healthy
            </span>
          </div>
        </Link>

        <Link className="platform-kpi-card" to="/platform/branches">
          <div className="platform-kpi-header">
            <span className="platform-kpi-title">
              <GitBranch size={15} aria-hidden="true" /> Branches
            </span>
            <span className="platform-kpi-icon-wrap">
              <ArrowUpRight size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="platform-kpi-value">{branchCount}</div>
          <div className="platform-kpi-footer">
            <span>{independentStores} parent organizations</span>
            <span className="platform-kpi-badge badge-info">Multi-tenant</span>
          </div>
        </Link>

        <Link className="platform-kpi-card" to="/platform/people">
          <div className="platform-kpi-header">
            <span className="platform-kpi-title">
              <Users size={15} aria-hidden="true" /> Platform Users
            </span>
            <span className="platform-kpi-icon-wrap">
              <ArrowUpRight size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="platform-kpi-value">{totalUsers}</div>
          <div className="platform-kpi-footer">
            <span>{activeUsers} active accounts</span>
            <span className="platform-kpi-badge badge-info">{superAdminCount} super admins</span>
          </div>
        </Link>

        <Link className="platform-kpi-card" to="/platform/devices">
          <div className="platform-kpi-header">
            <span className="platform-kpi-title">
              <Monitor size={15} aria-hidden="true" /> POS Terminals
            </span>
            <span className="platform-kpi-icon-wrap">
              <ArrowUpRight size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="platform-kpi-value">
            {onlineDevices}
            <small style={{ fontSize: "0.95rem", fontWeight: 500, color: "var(--muted)", marginLeft: "0.2rem" }}>
              / {totalDevices}
            </small>
          </div>
          <div className="platform-kpi-footer">
            <span>Seen in last 15 min</span>
            <span className={`platform-kpi-badge ${onlineDevices > 0 ? "badge-ok" : "badge-warn"}`}>
              {deviceOnlineRate}% online
            </span>
          </div>
        </Link>

        <Link className="platform-kpi-card" to="/platform/audit-logs">
          <div className="platform-kpi-header">
            <span className="platform-kpi-title">
              <ShieldCheck size={15} aria-hidden="true" /> Audit Trail Today
            </span>
            <span className="platform-kpi-icon-wrap">
              <ArrowUpRight size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="platform-kpi-value">{auditToday}</div>
          <div className="platform-kpi-footer">
            <span>{failedSync} sync alerts</span>
            <span className={`platform-kpi-badge ${failedSync === 0 ? "badge-ok" : "badge-danger"}`}>
              {failedSync === 0 ? "Sync healthy" : `${failedSync} errors`}
            </span>
          </div>
        </Link>
      </section>

      {/* Deep-Dive Operational & Commercial Health */}
      <div className="platform-grid-2">
        {/* Section 1: Estate Operational Telemetry */}
        <section className="platform-card">
          <div className="platform-card-header">
            <div>
              <h2>Estate Operational Telemetry</h2>
              <p>System health, device connectivity, and multi-tenant operational status.</p>
            </div>
            <span className="platform-kpi-badge badge-ok">
              <CheckCircle2 size={13} aria-hidden="true" /> Live
            </span>
          </div>

          <div className="platform-health-stack">
            <div className="platform-health-item">
              <div className="platform-health-label">
                <span>Active Store Operating Ratio</span>
                <span className="metric">{healthyStores} of {totalStores} stores ({storeHealthRate}%)</span>
              </div>
              <div className="platform-progress-track">
                <div
                  className={`platform-progress-fill ${storeHealthRate > 80 ? "fill-ok" : "fill-warn"}`}
                  style={{ width: `${storeHealthRate}%` }}
                />
              </div>
            </div>

            <div className="platform-health-item">
              <div className="platform-health-label">
                <span>Hardware Terminal Connectivity</span>
                <span className="metric">{onlineDevices} of {totalDevices} terminals ({deviceOnlineRate}%)</span>
              </div>
              <div className="platform-progress-track">
                <div
                  className={`platform-progress-fill ${deviceOnlineRate > 50 ? "fill-ok" : "fill-warn"}`}
                  style={{ width: `${deviceOnlineRate}%` }}
                />
              </div>
            </div>

            <div className="platform-health-item">
              <div className="platform-health-label">
                <span>Multi-Tenant Sync Queue Health</span>
                <span className="metric">{pendingSync} pending · {failedSync} errors</span>
              </div>
              <div className="platform-progress-track">
                <div
                  className={`platform-progress-fill ${failedSync === 0 ? "fill-ok" : "fill-danger"}`}
                  style={{ width: `${failedSync === 0 ? 100 : Math.max(10, 100 - failedSync * 10)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="platform-resource-list" style={{ marginTop: "1.25rem" }}>
            <Link className="platform-resource-row" to="/platform/stores">
              <span>
                <strong>Operational Stores</strong>
                <small>Stores actively trading and syncing</small>
              </span>
              <b>{healthyStores}</b>
            </Link>
            <Link className="platform-resource-row" to="/platform/stores">
              <span>
                <strong>Suspended / Paused Stores</strong>
                <small>Tenants locked or paused by administration</small>
              </span>
              <b style={{ color: pausedStores > 0 ? "var(--warn)" : "inherit" }}>{pausedStores}</b>
            </Link>
            <Link className="platform-resource-row" to="/platform/devices">
              <span>
                <strong>Connected Devices</strong>
                <small>Registered ESC/POS and desktop web terminals</small>
              </span>
              <b>{totalDevices}</b>
            </Link>
            <Link className="platform-resource-row" to="/platform/synchronization">
              <span>
                <strong>Offline Sync Queue Pressure</strong>
                <small>Queued offline orders waiting for ledger commit</small>
              </span>
              <b>{pendingSync}</b>
            </Link>
          </div>
        </section>

        {/* Section 2: Commercial & Governance Coverage */}
        <section className="platform-card">
          <div className="platform-card-header">
            <div>
              <h2>Commercial & Compliance Governance</h2>
              <p>Plan coverage, subscriber rates, and audit compliance trails.</p>
            </div>
            <span className="platform-kpi-badge badge-info">
              <ShieldCheck size={13} aria-hidden="true" /> Governance
            </span>
          </div>

          <div className="platform-health-stack">
            <div className="platform-health-item">
              <div className="platform-health-label">
                <span>Store Subscription Penetration</span>
                <span className="metric">{activeSubs} of {totalStores} stores ({subAdoptionRate}%)</span>
              </div>
              <div className="platform-progress-track">
                <div
                  className={`platform-progress-fill ${subAdoptionRate > 75 ? "fill-ok" : "fill-warn"}`}
                  style={{ width: `${subAdoptionRate}%` }}
                />
              </div>
            </div>

            <div className="platform-health-item">
              <div className="platform-health-label">
                <span>Super Admin Operator Ratio</span>
                <span className="metric">{superAdminCount} super admins of {totalUsers} users</span>
              </div>
              <div className="platform-progress-track">
                <div
                  className="platform-progress-fill fill-ok"
                  style={{ width: `${totalUsers > 0 ? Math.min(100, Math.round((superAdminCount / totalUsers) * 100)) : 100}%` }}
                />
              </div>
            </div>
          </div>

          <div className="platform-resource-list" style={{ marginTop: "1.25rem" }}>
            <Link className="platform-resource-row" to="/platform/subscriptions">
              <span>
                <strong>Active Subscriptions</strong>
                <small>Stores covered by commercial plans</small>
              </span>
              <b style={{ color: "var(--ok)" }}>{activeSubs}</b>
            </Link>
            <Link className="platform-resource-row" to="/platform/subscriptions">
              <span>
                <strong>Stores Awaiting Subscription</strong>
                <small>New tenants without assigned billing plan</small>
              </span>
              <b style={{ color: unassignedStores > 0 ? "var(--warn)" : "inherit" }}>{unassignedStores}</b>
            </Link>
            <Link className="platform-resource-row" to="/platform/people">
              <span>
                <strong>Platform Super Administrators</strong>
                <small>Accounts with global cross-tenant privileges</small>
              </span>
              <b>{superAdminCount}</b>
            </Link>
            <Link className="platform-resource-row" to="/platform/audit-logs">
              <span>
                <strong>Audit Velocity Today</strong>
                <small>Immutable security events logged today</small>
              </span>
              <b>{auditToday}</b>
            </Link>
          </div>

          {unassignedStores > 0 && (
            <div
              style={{
                marginTop: "1rem",
                padding: "0.75rem",
                borderRadius: "var(--radius-sm)",
                background: "var(--warn-soft)",
                border: "1px solid rgba(217, 119, 6, 0.25)",
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                fontSize: "0.78rem",
                color: "var(--warn)",
              }}
            >
              <AlertTriangle size={16} flex-shrink={0} aria-hidden="true" />
              <span>
                <strong>{unassignedStores} store{unassignedStores === 1 ? "" : "s"}</strong> currently {unassignedStores === 1 ? "has" : "have"} no active commercial plan. Visit <Link to="/platform/subscriptions" style={{ color: "inherit", textDecoration: "underline", fontWeight: 700 }}>Billing</Link> to assign tiers.
              </span>
            </div>
          )}
        </section>
      </div>

      {/* Domain Quick Overview Ledger */}
      <section className="platform-card">
        <div className="platform-card-header">
          <div>
            <h2>Platform Operations Summary</h2>
            <p>High-level breakdown of all governance domains across your OmniPOS deployment.</p>
          </div>
        </div>

        <div className="platform-table-wrap">
          <table className="platform-table-pro">
            <thead>
              <tr>
                <th>Governance Domain</th>
                <th>Managed Metric</th>
                <th>Count / Status</th>
                <th>Health Signal</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Tenants & Outlets</strong></td>
                <td>Stores & Branches</td>
                <td>{totalStores} stores ({branchCount} branches)</td>
                <td>
                  <span className={`platform-status ${healthyStores === totalStores ? "platform-status-active" : "platform-status-suspended"}`}>
                    {healthyStores} / {totalStores} active
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <Link to="/platform/stores" className="audit-inspect-btn">
                    Manage Stores <ArrowUpRight size={13} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
              <tr>
                <td><strong>Platform Users</strong></td>
                <td>Staff & Super Admins</td>
                <td>{totalUsers} registered accounts</td>
                <td>
                  <span className="platform-status platform-status-active">
                    {activeUsers} active
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <Link to="/platform/people" className="audit-inspect-btn">
                    Manage Users <ArrowUpRight size={13} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
              <tr>
                <td><strong>POS Terminals</strong></td>
                <td>Hardware & Web Tills</td>
                <td>{totalDevices} registered devices</td>
                <td>
                  <span className={`platform-status ${onlineDevices > 0 ? "platform-status-active" : "platform-status-suspended"}`}>
                    {onlineDevices} online now
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <Link to="/platform/devices" className="audit-inspect-btn">
                    Manage Devices <ArrowUpRight size={13} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
              <tr>
                <td><strong>Billing & Plans</strong></td>
                <td>Tenant Subscriptions</td>
                <td>{activeSubs} active plans ({unassignedStores} unassigned)</td>
                <td>
                  <span className={`platform-status ${unassignedStores === 0 ? "platform-status-active" : "platform-status-suspended"}`}>
                    {subAdoptionRate}% assigned
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <Link to="/platform/subscriptions" className="audit-inspect-btn">
                    Manage Billing <ArrowUpRight size={13} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
              <tr>
                <td><strong>Sync Engine</strong></td>
                <td>Offline Operations & Queue</td>
                <td>{pendingSync} pending · {failedSync} errors</td>
                <td>
                  <span className={`platform-status ${failedSync === 0 ? "platform-status-active" : "platform-status-inactive"}`}>
                    {failedSync === 0 ? "Queue Healthy" : `${failedSync} Failures`}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <Link to="/platform/synchronization" className="audit-inspect-btn">
                    Sync Monitor <ArrowUpRight size={13} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
              <tr>
                <td><strong>Audit & Compliance</strong></td>
                <td>Immutable Activity Trail</td>
                <td>{auditToday} security events logged today</td>
                <td>
                  <span className="platform-status platform-status-active">
                    <Database size={11} style={{ marginRight: 4 }} aria-hidden="true" />
                    Recording
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <Link to="/platform/audit-logs" className="audit-inspect-btn">
                    Audit Log <ArrowUpRight size={13} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </PlatformPage>
  );
}
