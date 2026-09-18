import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { Activity, CheckCircle2, Cpu, Database, Eye, Plus, ShieldCheck, Store, Users, Wifi, WifiOff } from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";

type SystemStore = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  members_count: number;
  orders_count: number;
  owner: { id: string; name: string; email: string } | null;
  created_at: string | null;
  platform_status: "active" | "suspended" | "inactive";
};

type PlatformDashboard = {
  stores: { total: number; active: number; inactive: number; branches: number };
  users: { total: number; active: number; super_admins: number };
  devices: { total: number; online: number };
  sync: { pending: number; failed: number };
  audit_events_today: number;
};

type PlatformMember = { id: string; role: string; user: { name: string; email: string } | null };
type PlatformUser = { id: string; name: string; email: string; is_super_admin: boolean; active: boolean; stores_count: number };
type PlatformDevice = { id: string; platform: string; terminal_label: string | null; app_version: string | null; platform_status: string; last_seen_at: string | null; store: { name: string } | null };
type PlatformAudit = { id: number; action: string; entity_type: string | null; entity_id: string | null; store_id: string | null; user: { name: string; email: string } | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; ip_address: string | null; created_at: string | null };
type SyncMonitor = {
  summary: { stores_online: number; stores_total: number; devices_online: number; devices_total: number; pending_operations: number; failed_operations: number; open_conflicts: number };
  stores: Array<{ id: string; name: string; platform_status: string; devices: Array<{ id: string; label: string; platform: string; status: string; online: boolean; last_seen_at: string | null }> }>;
  recent_failures: Array<{ operation_id: string; status: string; store: string | null; device: string | null; entity: string; record_id: string; error: string | null; created_at: string | null }>;
};
type PlatformPlan = { id: string; name: string; slug: string; description: string | null; monthly_price: string; limits: Record<string, unknown>; platform_status: string; subscriptions_count: number };
type PlatformSubscription = { id: string; status: string; starts_at: string; ends_at: string | null; store: { id: string; name: string } | null; plan: { id: string; name: string; monthly_price: string } | null };

type Provisioned = {
  store: { id: string; name: string };
  admin: { name: string; email: string };
  account_created: boolean;
};

/**
 * Platform operations: every store on the installation, and provisioning a new
 * one with the person who will run it.
 *
 * A super admin acts across tenants by definition, so none of this can sit
 * behind the store boundary that protects everything else. The privilege is
 * verified on the server for every call here; the route guard on this page only
 * saves a pointless request.
 */
export function SuperAdminPage() {
  const isSuperAdmin = useSession((s) => s.user?.is_super_admin ?? false);
  const location = useLocation();
  const queryClient = useQueryClient();
  const activeModule = location.pathname.split("/")[2] ?? "dashboard";
  const moduleLabel = activeModule === "audit-logs"
    ? "Audit Logs"
    : activeModule === "synchronization"
      ? "Synchronization"
      : activeModule.charAt(0).toUpperCase() + activeModule.slice(1);

  const [form, setForm] = useState({
    store_name: "",
    currency: "GHS",
    timezone: "Africa/Accra",
    admin_name: "",
    admin_email: "",
    admin_password: "",
  });
  const [result, setResult] = useState<Provisioned | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [membersFor, setMembersFor] = useState<SystemStore | null>(null);
  const [auditAction, setAuditAction] = useState("");
  const [planForm, setPlanForm] = useState({ name: "", slug: "", monthly_price: "", description: "", limits: "" });

  const stores = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => (await api.get<{ data: SystemStore[] }>("/api/admin/stores", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const dashboard = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => api.get<PlatformDashboard>("/api/admin/dashboard", undefined, { storeless: true }),
    enabled: isSuperAdmin,
  });
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => (await api.get<{ data: PlatformUser[] }>("/api/admin/users", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });
  const devices = useQuery({
    queryKey: ["admin-devices"],
    queryFn: async () => (await api.get<{ data: PlatformDevice[] }>("/api/admin/devices", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });
  const members = useQuery({
    queryKey: ["admin-members", membersFor?.id],
    queryFn: async () => (await api.get<{ data: PlatformMember[] }>(`/api/admin/stores/${membersFor?.id}/members`, undefined, { storeless: true })).data ?? [],
    enabled: Boolean(membersFor),
  });
  const auditLogs = useQuery({
    queryKey: ["admin-audit-logs", auditAction],
    queryFn: async () => (await api.get<{ data: PlatformAudit[] }>("/api/admin/audit-logs", { action: auditAction || undefined, limit: "30" }, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });
  const syncMonitor = useQuery({
    queryKey: ["admin-sync-monitor"],
    queryFn: () => api.get<SyncMonitor>("/api/admin/sync-monitor", undefined, { storeless: true }),
    enabled: isSuperAdmin,
    refetchInterval: 30000,
  });
  const plans = useQuery({
    queryKey: ["admin-plans"],
    queryFn: async () => (await api.get<{ data: PlatformPlan[] }>("/api/admin/plans", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });
  const subscriptions = useQuery({
    queryKey: ["admin-subscriptions"],
    queryFn: async () => (await api.get<{ data: PlatformSubscription[] }>("/api/admin/subscriptions", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });
  const createPlan = useMutation({
    mutationFn: () => api.post("/api/admin/plans", { ...planForm, monthly_price: Number(planForm.monthly_price || 0), limits: planForm.limits ? JSON.parse(planForm.limits) : {} }, { storeless: true }),
    onSuccess: () => { setPlanForm({ name: "", slug: "", monthly_price: "", description: "", limits: "" }); setToast("Plan created."); void queryClient.invalidateQueries({ queryKey: ["admin-plans"] }); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not create plan."),
  });
  const assignPlan = useMutation({
    mutationFn: ({ storeId, planId }: { storeId: string; planId: string }) => api.post(`/api/admin/stores/${storeId}/subscription`, { plan_id: planId }, { storeless: true }),
    onSuccess: () => { setToast("Subscription updated."); void queryClient.invalidateQueries({ queryKey: ["admin-subscriptions"] }); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not update subscription."),
  });

  const changeStatus = useMutation({
    mutationFn: ({ storeId, status }: { storeId: string; status: SystemStore["platform_status"] }) => api.patch(`/api/admin/stores/${storeId}/status`, { status }, { storeless: true }),
    onSuccess: () => {
      setToast("Store status updated.");
      void queryClient.invalidateQueries({ queryKey: ["admin-stores"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not update store status."),
  });

  const provision = useMutation({
    mutationFn: () =>
      api.post<Provisioned>(
        "/api/admin/stores",
        {
          store_name: form.store_name.trim(),
          currency: form.currency.trim(),
          timezone: form.timezone.trim(),
          admin_name: form.admin_name.trim() || undefined,
          admin_email: form.admin_email.trim(),
          admin_password: form.admin_password || undefined,
        },
        { storeless: true },
      ),
    onSuccess: async (res) => {
      setResult(res);
      setError(null);
      setForm({ ...form, store_name: "", admin_name: "", admin_email: "", admin_password: "" });
      await queryClient.invalidateQueries({ queryKey: ["admin-stores"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not create the store."),
  });

  if (!isSuperAdmin) {
    return (
      <div className="page">
        <h1><ShieldCheck size={20} aria-hidden="true" /> Platform</h1>
        <p className="notice notice-warn">This area is limited to platform administrators.</p>
      </div>
    );
  }

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <div className="page platform-page">
      <header className="page-header">
        <div><h1><ShieldCheck size={20} aria-hidden="true" /> {moduleLabel} <span className="platform-heading-context">Platform Control Center</span></h1><p className="muted">Platform management only. Store teams own operational resources.</p></div>
        <span className="platform-scope-badge"><ShieldCheck size={14} /> Super Admin</span>
      </header>

      {toast && <p className="platform-toast" role="status"><CheckCircle2 size={16} />{toast}</p>}

      <section className="platform-kpi-grid">
        <PlatformKpi icon={Store} label="Stores" value={dashboard.data?.stores.total ?? stores.data?.length ?? 0} hint={`${dashboard.data?.stores.active ?? 0} active`} />
        <PlatformKpi icon={Activity} label="Branches" value={dashboard.data?.stores.branches ?? 0} hint="Platform visibility" />
        <PlatformKpi icon={Users} label="Users" value={dashboard.data?.users.total ?? users.data?.length ?? 0} hint={`${dashboard.data?.users.active ?? 0} active`} />
        <PlatformKpi icon={Cpu} label="Devices online" value={`${dashboard.data?.devices.online ?? 0}/${dashboard.data?.devices.total ?? devices.data?.length ?? 0}`} hint={`${dashboard.data?.sync.pending ?? 0} sync pending`} />
        <PlatformKpi icon={Database} label="Failed sync" value={dashboard.data?.sync.failed ?? 0} hint={`${dashboard.data?.audit_events_today ?? 0} audit events today`} />
      </section>

      <section className="drawer-card" id="provision-store">
        <h2>Provision a store</h2>
        <p className="conflict-hint">
          The store and its admin are created together, in one transaction. Doing it in two steps is how a store ends
          up with nobody able to administer it.
        </p>

        {result && (
          <p className="notice notice-ok" role="status">
            {result.store.name} created.{" "}
            {result.account_created
              ? `A new login was made for ${result.admin.email} — give them the password you set.`
              : `${result.admin.email} already had a login, and it now has access. They keep their existing password.`}
          </p>
        )}

        {error && <p className="notice notice-error" role="status">{error}</p>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setResult(null);
            provision.mutate();
          }}
        >
          <label htmlFor="sa-store">Store name</label>
          <input id="sa-store" {...field("store_name")} required />

          <div className="form-row">
            <div>
              <label htmlFor="sa-currency">Currency</label>
              <input id="sa-currency" {...field("currency")} />
            </div>
            <div>
              <label htmlFor="sa-tz">Timezone</label>
              <input id="sa-tz" {...field("timezone")} />
            </div>
          </div>

          <h3 className="settings-subhead">Who will run it</h3>

          <div className="form-row">
            <div>
              <label htmlFor="sa-admin-name">Name</label>
              <input id="sa-admin-name" {...field("admin_name")} />
            </div>
            <div>
              <label htmlFor="sa-admin-email">Email</label>
              <input id="sa-admin-email" type="email" {...field("admin_email")} required />
            </div>
          </div>

          <label htmlFor="sa-admin-password">Password</label>
          <input id="sa-admin-password" type="password" {...field("admin_password")} autoComplete="new-password" />
          {/*
            Only needed for someone who has no login yet. Saying so avoids the
            other reading — that this would overwrite an existing password,
            which it never does.
          */}
          <p className="conflict-hint">
            Only needed if this email has no account yet. An existing login keeps the password it already has.
          </p>

          <button type="submit" className="pay-button" disabled={provision.isPending}>
            {provision.isPending ? "Creating…" : "Create store and admin"}
          </button>
        </form>
      </section>

      <div className="platform-section-heading"><div><h2>Stores</h2><p>Activate, suspend, and inspect platform entities. Operational data remains store-owned.</p></div><button type="button" className="secondary-button" onClick={() => document.getElementById("provision-store")?.scrollIntoView({ behavior: "smooth" })}><Plus size={16} /> Add store</button></div>
      <table className="table">
        <thead>
          <tr><th>Store</th><th>Status</th><th>Owner</th><th>Staff</th><th>Sales</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {(stores.data ?? []).map((s) => (
            <tr key={s.id}>
              <td>
                {s.name}
                <span className="muted"> · {s.currency}</span>
              </td>
              <td><span className={`platform-status platform-status-${s.platform_status}`}>{s.platform_status}</span></td>
              <td>
                {s.owner?.name ?? "—"}
                {s.owner && <span className="muted mono"> {s.owner.email}</span>}
              </td>
              <td>{s.members_count}</td>
              {/* The first thing anyone asks looking at this list is which of
                  these are actually being used. */}
              <td className={s.orders_count === 0 ? "muted" : undefined}>
                {s.orders_count === 0 ? "never used" : s.orders_count}
              </td>
              <td className="platform-row-actions"><button type="button" className="icon-button" onClick={() => setMembersFor(s)} title="View store members" aria-label={`View members for ${s.name}`}><Eye size={16} /></button><select value={s.platform_status} onChange={(event) => changeStatus.mutate({ storeId: s.id, status: event.target.value as SystemStore["platform_status"] })} aria-label={`Change status for ${s.name}`}><option value="active">Active</option><option value="suspended">Suspended</option><option value="inactive">Inactive</option></select></td>
            </tr>
          ))}
        </tbody>
      </table>

      {stores.isLoading && <p className="muted">Loading…</p>}
      {stores.error && (
        <p className="notice notice-warn">
          {stores.error instanceof Error ? stores.error.message : "Could not load the store list."}
        </p>
      )}

      <div className="platform-two-column">
        <section className="platform-panel"><div className="platform-section-heading"><div><h2>People</h2><p>Platform access and store membership visibility.</p></div><span className="platform-panel-count">{users.data?.length ?? 0}</span></div>{users.data?.slice(0, 6).map((user) => <div className="platform-member-row" key={user.id}><span><strong>{user.name}{user.is_super_admin ? " · Platform Admin" : ""}</strong><small>{user.email} · {user.stores_count} store{user.stores_count === 1 ? "" : "s"}</small></span><b className={user.active ? "platform-status-active" : "platform-status-inactive"}>{user.active ? "Active" : "Inactive"}</b></div>)}{users.isLoading && <p className="muted">Loading users…</p>}</section>
        <section className="platform-panel"><div className="platform-section-heading"><div><h2>System Devices</h2><p>Registration and synchronization visibility.</p></div><span className="platform-panel-count">{devices.data?.length ?? 0}</span></div>{devices.data?.slice(0, 6).map((device) => <div className="platform-member-row" key={device.id}><span><strong>{device.terminal_label ?? device.platform}</strong><small>{device.store?.name ?? "Unassigned"} · {device.app_version ?? "Unknown version"}</small></span><b className={device.platform_status === "active" ? "platform-status-active" : "platform-status-inactive"}>{device.platform_status}</b></div>)}{devices.isLoading && <p className="muted">Loading devices…</p>}</section>
      </div>

      <section className="platform-panel platform-subscription-panel"><div className="platform-section-heading"><div><h2>Plans &amp; Subscriptions</h2><p>Manage the platform-to-store subscription relationship, not store operations.</p></div><span className="platform-panel-count">{plans.data?.length ?? 0}</span></div><form className="platform-plan-form" onSubmit={(event) => { event.preventDefault(); createPlan.mutate(); }}><input placeholder="Plan name" value={planForm.name} onChange={(event) => setPlanForm({ ...planForm, name: event.target.value })} required /><input placeholder="Slug" value={planForm.slug} onChange={(event) => setPlanForm({ ...planForm, slug: event.target.value })} required /><input type="number" min="0" step="0.01" placeholder="Monthly price" value={planForm.monthly_price} onChange={(event) => setPlanForm({ ...planForm, monthly_price: event.target.value })} required /><input placeholder='Limits JSON, e.g. {"users":10}' value={planForm.limits} onChange={(event) => setPlanForm({ ...planForm, limits: event.target.value })} /><button type="submit" className="secondary-button" disabled={createPlan.isPending}><Plus size={15} /> Create plan</button></form><div className="platform-plan-list">{plans.data?.map((plan) => <div className="platform-plan-row" key={plan.id}><span><strong>{plan.name}</strong><small>{plan.monthly_price} · {plan.subscriptions_count} subscription{plan.subscriptions_count === 1 ? "" : "s"}</small></span><b className="platform-status-active">{plan.platform_status}</b></div>)}</div><h3 className="platform-subheading">Active store subscriptions</h3><div className="platform-subscription-list">{subscriptions.data?.map((subscription) => <div className="platform-subscription-row" key={subscription.id}><span><strong>{subscription.store?.name ?? "Unknown store"}</strong><small>{subscription.plan?.name ?? "No plan"} · {subscription.status}</small></span><select value={subscription.plan?.id ?? ""} onChange={(event) => { if (subscription.store) assignPlan.mutate({ storeId: subscription.store.id, planId: event.target.value }); }} aria-label={`Change plan for ${subscription.store?.name ?? "store"}`}><option value="" disabled>Choose plan</option>{plans.data?.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></div>)}</div></section>

      <section className="platform-panel platform-audit-panel"><div className="platform-section-heading"><div><h2>Audit Log</h2><p>Read-only record of platform and store-management actions.</p></div><select value={auditAction} onChange={(event) => setAuditAction(event.target.value)} aria-label="Filter audit actions"><option value="">All actions</option><option value="platform.store">Store actions</option><option value="platform.device">Device actions</option><option value="staff.">Staff actions</option></select></div>{auditLogs.isLoading && <p className="muted">Loading audit activity…</p>}{auditLogs.data?.length === 0 && !auditLogs.isLoading && <p className="muted">No audit activity recorded yet.</p>}<div className="platform-audit-list">{auditLogs.data?.map((log) => <article className="platform-audit-row" key={log.id}><span className="platform-audit-time">{log.created_at ? new Date(log.created_at).toLocaleString() : "—"}</span><span><strong>{log.action}</strong><small>{log.user?.name ?? "System"} · {log.entity_type ?? "platform"}{log.store_id ? ` · Store ${log.store_id.slice(0, 8)}` : ""}</small></span><code>{log.after ? JSON.stringify(log.after) : "—"}</code></article>)}</div></section>

      <section className="platform-panel platform-sync-panel"><div className="platform-section-heading"><div><h2>Synchronization Monitor</h2><p>System-wide health visibility. No store operational data can be edited here.</p></div><span className="platform-panel-count">30s</span></div><div className="platform-sync-summary"><SyncMetric label="Stores online" value={`${syncMonitor.data?.summary.stores_online ?? 0}/${syncMonitor.data?.summary.stores_total ?? 0}`} /><SyncMetric label="Devices online" value={`${syncMonitor.data?.summary.devices_online ?? 0}/${syncMonitor.data?.summary.devices_total ?? 0}`} /><SyncMetric label="Pending" value={syncMonitor.data?.summary.pending_operations ?? 0} /><SyncMetric label="Failed" value={syncMonitor.data?.summary.failed_operations ?? 0} /><SyncMetric label="Conflicts" value={syncMonitor.data?.summary.open_conflicts ?? 0} /></div>{syncMonitor.isLoading && <p className="muted">Loading synchronization health…</p>}<div className="platform-sync-stores">{syncMonitor.data?.stores.map((store) => <div className="platform-sync-store" key={store.id}><div><strong>{store.name}</strong><small>{store.devices.length} registered device{store.devices.length === 1 ? "" : "s"}</small></div><span>{store.devices.some((device) => device.online) ? <Wifi size={16} /> : <WifiOff size={16} />}{store.devices.filter((device) => device.online).length} online</span></div>)}</div>{(syncMonitor.data?.recent_failures.length ?? 0) > 0 && <div className="platform-failure-list"><h3>Recent failures</h3>{syncMonitor.data?.recent_failures.slice(0, 8).map((failure) => <div className="platform-failure-row" key={failure.operation_id}><span><strong>{failure.status} · {failure.entity}</strong><small>{failure.store ?? "Unknown store"} · {failure.device ?? "Unknown device"}</small></span><code>{failure.error ?? "No error detail"}</code></div>)}</div>}</section>

      {membersFor && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Members of ${membersFor.name}`}><div className="modal platform-members-modal"><header className="platform-modal-heading"><div><h2>{membersFor.name}</h2><p>Store access only. Operational resources are not exposed here.</p></div><button type="button" className="icon-button" onClick={() => setMembersFor(null)} aria-label="Close members">×</button></header>{members.isLoading && <p className="muted">Loading members…</p>}{members.data?.map((member) => <div className="platform-member-row" key={member.id}><span><strong>{member.user?.name ?? "Unknown user"}</strong><small>{member.user?.email ?? "—"}</small></span><b>{member.role}</b></div>)}</div></div>}
    </div>
  );
}

function PlatformKpi({ icon: Icon, label, value, hint }: { icon: typeof Store; label: string; value: string | number; hint: string }) {
  return <div className="platform-kpi"><span><Icon size={17} />{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}

function SyncMetric({ label, value }: { label: string; value: string | number }) {
  return <div><small>{label}</small><strong>{value}</strong></div>;
}
