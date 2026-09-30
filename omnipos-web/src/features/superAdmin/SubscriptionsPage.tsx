import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Coins,
  Edit2,
  Layers,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Search,
  Store,
  Users,
  X,
} from "lucide-react";

import { api } from "@/api/client";
import { printTableAsPdf } from "@/utils/printTable";
import {
  EmptyState,
  Field,
  PlatformDenied,
  PlatformModal,
  PlatformPage,
  PlatformToast,
  StatusBadge,
  usePlatformAccess,
  useToast,
} from "./PlatformChrome";

type SubscriptionRow = {
  id: string;
  status: string;
  store: { id: string; name: string; platform_status: string } | null;
  plan: { id: string; name: string; monthly_price: string } | null;
  starts_at: string | null;
  ends_at: string | null;
};

type PlanRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  monthly_price: string;
  limits: Record<string, unknown>;
  platform_status: string;
  subscriptions_count: number;
};

type StoreOption = {
  id: string;
  name: string;
  platform_status?: string;
};

const emptyPlan = {
  name: "",
  slug: "",
  description: "",
  monthly_price: "",
  limits: '{"users": 10, "devices": 3}',
};

export function SubscriptionsPage() {
  const isSuperAdmin = usePlatformAccess();
  const queryClient = useQueryClient();
  const { toast, setToast } = useToast();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [planOpen, setPlanOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState(emptyPlan);
  const [assign, setAssign] = useState({ storeId: "", planId: "" });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const plans = useQuery({
    queryKey: ["admin-plans-page"],
    queryFn: async () =>
      (await api.get<{ data: PlanRow[] }>("/api/admin/plans", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const subscriptions = useQuery({
    queryKey: ["admin-subscriptions-page"],
    queryFn: async () =>
      (await api.get<{ data: SubscriptionRow[] }>("/api/admin/subscriptions", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const stores = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () =>
      (await api.get<{ data: StoreOption[] }>("/api/admin/stores", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const savePlan = useMutation({
    mutationFn: () => {
      let parsedLimits = {};
      try {
        if (planForm.limits) parsedLimits = JSON.parse(planForm.limits);
      } catch {
        throw new Error("Invalid limits JSON format. Please verify syntax.");
      }

      const payload = {
        name: planForm.name.trim(),
        slug: planForm.slug.trim(),
        description: planForm.description ? planForm.description.trim() : null,
        monthly_price: Number(planForm.monthly_price || 0),
        limits: parsedLimits,
      };

      if (editingPlanId) return api.patch(`/api/admin/plans/${editingPlanId}`, payload, { storeless: true });
      return api.post("/api/admin/plans", payload, { storeless: true });
    },
    onSuccess: () => {
      setPlanForm(emptyPlan);
      setEditingPlanId(null);
      setPlanOpen(false);
      setToast(editingPlanId ? "Commercial plan updated successfully." : "New commercial plan created.");
      void queryClient.invalidateQueries({ queryKey: ["admin-plans-page"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not save the plan. Verify details."),
  });

  const archivePlan = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/plans/${id}`, { storeless: true }),
    onSuccess: () => {
      setToast("Commercial plan archived.");
      void queryClient.invalidateQueries({ queryKey: ["admin-plans-page"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not archive the plan."),
  });

  const assignPlan = useMutation({
    mutationFn: () =>
      api.post(`/api/admin/stores/${assign.storeId}/subscription`, { plan_id: assign.planId }, { storeless: true }),
    onSuccess: () => {
      setAssignOpen(false);
      setAssign({ storeId: "", planId: "" });
      setToast("Subscription tier successfully assigned to tenant store.");
      void queryClient.invalidateQueries({ queryKey: ["admin-subscriptions-page"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-plans-page"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not assign subscription tier."),
  });

  const changeSubscription = useMutation({
    mutationFn: ({ storeId, planId }: { storeId: string; planId: string }) =>
      api.post(`/api/admin/stores/${storeId}/subscription`, { plan_id: planId }, { storeless: true }),
    onSuccess: () => {
      setToast("Store subscription updated.");
      void queryClient.invalidateQueries({ queryKey: ["admin-subscriptions-page"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-plans-page"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not update the subscription."),
  });

  const allSubs = subscriptions.data ?? [];
  const planList = plans.data ?? [];
  const storeList = stores.data ?? [];

  // Commercial KPIs calculation
  const totalMrr = useMemo(() => {
    return allSubs
      .filter((s) => s.status === "active" && s.plan)
      .reduce((sum, s) => sum + Number(s.plan?.monthly_price || 0), 0);
  }, [allSubs]);

  const activeSubCount = useMemo(() => {
    return allSubs.filter((s) => s.status === "active").length;
  }, [allSubs]);

  const unassignedStoreCount = useMemo(() => {
    const subscribedStoreIds = new Set(allSubs.filter((s) => s.status === "active").map((s) => s.store?.id).filter(Boolean));
    return storeList.filter((s) => !subscribedStoreIds.has(s.id)).length;
  }, [allSubs, storeList]);

  const filteredSubs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allSubs.filter((item) => {
      const storeName = item.store?.name ?? "";
      const planName = item.plan?.name ?? "";
      const status = item.status ?? "";
      const matchesSearch = `${storeName} ${planName} ${status}`.toLowerCase().includes(needle);

      if (!matchesSearch) return false;
      if (statusFilter === "active") return item.status === "active";
      if (statusFilter === "inactive") return item.status !== "active";
      return true;
    });
  }, [allSubs, query, statusFilter]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([plans.refetch(), subscriptions.refetch(), stores.refetch()]);
    setIsRefreshing(false);
  };

  const handleExportPdf = () => {
    printTableAsPdf({
      title: "OmniPOS Multi-Tenant Commercial Billing Roster",
      columns: ["Store Organization", "Assigned Plan", "Monthly Rate", "Subscription Status", "Billing Start", "Renewal Date"],
      rows: filteredSubs.map((sub) => [
        sub.store?.name ?? "—",
        sub.plan?.name ?? "Unassigned",
        sub.plan?.monthly_price ? `${Number(sub.plan.monthly_price).toFixed(2)} / mo` : "—",
        sub.status.toUpperCase(),
        sub.starts_at ? new Date(sub.starts_at).toLocaleDateString() : "—",
        sub.ends_at ? new Date(sub.ends_at).toLocaleDateString() : "Active Ongoing",
      ]),
    });
  };

  if (!isSuperAdmin) return <PlatformDenied title="Billing" />;

  return (
    <PlatformPage
      icon={Receipt}
      title="Commercial Plans & Billing"
      description="Define subscription plans, monitor tenant MRR run-rates, and govern store billing coverage."
      actions={
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            className="secondary-button"
            onClick={handleExportPdf}
            disabled={filteredSubs.length === 0}
            title="Export billing roster as printable PDF"
          >
            <Printer size={15} aria-hidden="true" />
            <span>Export Roster (PDF)</span>
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            title="Refresh subscriptions and plans"
          >
            <RefreshCw size={15} className={isRefreshing ? "spin-icon" : ""} aria-hidden="true" />
            <span>{isRefreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setAssignOpen(true)}
          >
            Assign Tenant Plan
          </button>
          <button
            type="button"
            className="pay-button"
            onClick={() => {
              setEditingPlanId(null);
              setPlanForm(emptyPlan);
              setPlanOpen(true);
            }}
          >
            <Plus size={16} /> New Plan Tier
          </button>
        </div>
      }
    >
      <PlatformToast message={toast} />

      {/* Commercial Telemetry KPI Bento Grid */}
      <section className="platform-kpi-bento" style={{ marginBottom: "1.25rem" }}>
        <div className="platform-kpi-card">
          <div className="platform-kpi-header">
            <span className="platform-kpi-title">
              <Coins size={15} aria-hidden="true" /> Monthly Run-Rate (MRR)
            </span>
            <span className="platform-kpi-icon-wrap">
              <Coins size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="platform-kpi-value">
            {totalMrr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="platform-kpi-footer">
            <span>Aggregated subscription revenue</span>
            <span className="platform-kpi-badge badge-ok">Platform MRR</span>
          </div>
        </div>

        <div className="platform-kpi-card">
          <div className="platform-kpi-header">
            <span className="platform-kpi-title">
              <Store size={15} aria-hidden="true" /> Subscribed Stores
            </span>
            <span className="platform-kpi-icon-wrap">
              <CheckCircle2 size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="platform-kpi-value">{activeSubCount}</div>
          <div className="platform-kpi-footer">
            <span>Active tenant coverage</span>
            <span className="platform-kpi-badge badge-ok">
              {storeList.length > 0 ? Math.round((activeSubCount / storeList.length) * 100) : 0}% covered
            </span>
          </div>
        </div>

        <div className="platform-kpi-card">
          <div className="platform-kpi-header">
            <span className="platform-kpi-title">
              <AlertCircle size={15} aria-hidden="true" /> Unassigned Stores
            </span>
            <span className="platform-kpi-icon-wrap">
              <AlertCircle size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="platform-kpi-value" style={{ color: unassignedStoreCount > 0 ? "var(--warn)" : "inherit" }}>
            {unassignedStoreCount}
          </div>
          <div className="platform-kpi-footer">
            <span>Awaiting plan assignment</span>
            <span className={`platform-kpi-badge ${unassignedStoreCount > 0 ? "badge-warn" : "badge-ok"}`}>
              {unassignedStoreCount > 0 ? "Action required" : "Zero pending"}
            </span>
          </div>
        </div>

        <div className="platform-kpi-card">
          <div className="platform-kpi-header">
            <span className="platform-kpi-title">
              <Layers size={15} aria-hidden="true" /> Commercial Tiers
            </span>
            <span className="platform-kpi-icon-wrap">
              <Layers size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="platform-kpi-value">{planList.length}</div>
          <div className="platform-kpi-footer">
            <span>{planList.filter((p) => p.platform_status === "active").length} active tiers</span>
            <span className="platform-kpi-badge badge-info">Catalog</span>
          </div>
        </div>
      </section>

      {/* Commercial Plans Tier Deck */}
      <div className="platform-card" style={{ marginBottom: "1.25rem" }}>
        <div className="platform-card-header">
          <div>
            <h2>Commercial Tiers & Limits</h2>
            <p>Pricing configurations and operational quotas applied to tenant subscriptions.</p>
          </div>
          <span className="platform-kpi-badge badge-info">
            {planList.length} defined tier{planList.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="platform-plans-deck">
          {planList.map((plan) => {
            const isArchived = plan.platform_status === "archived";
            const limitsObj = (plan.limits ?? {}) as Record<string, unknown>;
            const limitEntries = Object.entries(limitsObj);

            return (
              <article
                className={`platform-tier-card ${isArchived ? "tier-archived" : ""}`}
                key={plan.id}
              >
                <div>
                  <div className="platform-tier-top">
                    <div>
                      <h3 className="platform-tier-name">{plan.name}</h3>
                      <span className="platform-tier-slug">{plan.slug}</span>
                    </div>
                    <StatusBadge status={plan.platform_status} />
                  </div>

                  <div className="platform-tier-pricing">
                    <span className="platform-tier-amount">
                      {Number(plan.monthly_price).toFixed(2)}
                    </span>
                    <span className="platform-tier-period">/ month</span>
                  </div>

                  <p className="platform-tier-desc">
                    {plan.description || "Full-featured tenant operational access tier."}
                  </p>

                  {/* Limits Chips */}
                  <div className="platform-limits-chips">
                    {limitEntries.length > 0 ? (
                      limitEntries.map(([key, val]) => (
                        <span className="platform-limit-tag" key={key}>
                          <span style={{ textTransform: "capitalize" }}>{key}:</span>
                          <b>{String(val)}</b>
                        </span>
                      ))
                    ) : (
                      <span className="platform-limit-tag">
                        <span>Quotas:</span>
                        <b>Standard Defaults</b>
                      </span>
                    )}
                  </div>
                </div>

                <div className="platform-tier-foot">
                  <span className="platform-tier-subs">
                    <Users size={14} aria-hidden="true" />
                    <strong>{plan.subscriptions_count}</strong> store{plan.subscriptions_count === 1 ? "" : "s"}
                  </span>
                  <div style={{ display: "flex", gap: "0.35rem" }}>
                    <button
                      type="button"
                      className="audit-inspect-btn"
                      onClick={() => {
                        setEditingPlanId(plan.id);
                        setPlanForm({
                          name: plan.name,
                          slug: plan.slug,
                          description: plan.description ?? "",
                          monthly_price: String(plan.monthly_price),
                          limits: JSON.stringify(plan.limits ?? {}, null, 2),
                        });
                        setPlanOpen(true);
                      }}
                      title="Edit this plan"
                    >
                      <Edit2 size={13} aria-hidden="true" />
                      <span>Edit</span>
                    </button>
                    {!isArchived && (
                      <button
                        type="button"
                        className="audit-inspect-btn"
                        style={{ color: "var(--danger)" }}
                        onClick={() => {
                          if (window.confirm(`Archive ${plan.name}? Active subscriptions will continue, but no new stores can be assigned.`)) {
                            archivePlan.mutate(plan.id);
                          }
                        }}
                        title="Archive this tier"
                      >
                        <Archive size={13} aria-hidden="true" />
                        <span>Archive</span>
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {!plans.isLoading && planList.length === 0 && (
            <EmptyState
              title="No commercial plan tiers"
              hint="Create a commercial plan tier above before assigning stores."
            />
          )}
        </div>
      </div>

      {/* Tenant Subscriptions Management Ledger */}
      <section className="platform-card">
        <div className="platform-card-header">
          <div>
            <h2>Tenant Store Subscriptions</h2>
            <p>Commercial tier assignments, renewal schedules, and tenant plan transitions.</p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="platform-toolbar-pro">
          <div className="platform-toolbar-left">
            <label className="search-field platform-search" style={{ minWidth: "260px" }}>
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Search stores or assigned plans</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tenant store or plan…"
              />
              {query && (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </label>

            <div className="platform-chip-group">
              <button
                type="button"
                className={`platform-chip ${statusFilter === "all" ? "active" : ""}`}
                onClick={() => setStatusFilter("all")}
              >
                All ({allSubs.length})
              </button>
              <button
                type="button"
                className={`platform-chip ${statusFilter === "active" ? "active" : ""}`}
                onClick={() => setStatusFilter("active")}
              >
                Active ({activeSubCount})
              </button>
              <button
                type="button"
                className={`platform-chip ${statusFilter === "inactive" ? "active" : ""}`}
                onClick={() => setStatusFilter("inactive")}
              >
                Suspended / Expired
              </button>
            </div>
          </div>

          <div className="platform-toolbar-right">
            <span className="platform-panel-count" title="Matching store subscriptions">
              {filteredSubs.length}
            </span>
          </div>
        </div>

        {/* Subscriptions Table */}
        <div className="platform-table-wrap">
          <table className="platform-table-pro">
            <thead>
              <tr>
                <th>Tenant Store</th>
                <th>Assigned Tier</th>
                <th>Status</th>
                <th>Cycle Started</th>
                <th>Renewal / End</th>
                <th style={{ textAlign: "right" }}>Switch Tier</th>
              </tr>
            </thead>
            <tbody>
              {filteredSubs.map((item) => (
                <tr key={item.id}>
                  {/* Store Column */}
                  <td>
                    <div style={{ display: "grid", gap: "0.15rem" }}>
                      <strong style={{ fontSize: "0.85rem" }}>
                        {item.store?.name ?? "—"}
                      </strong>
                      <small style={{ color: "var(--muted)", fontSize: "0.72rem" }}>
                        Tenant ID: #{item.store?.id ? item.store.id.slice(0, 8) : "N/A"}
                      </small>
                    </div>
                  </td>

                  {/* Plan Column */}
                  <td>
                    <div style={{ display: "grid", gap: "0.15rem" }}>
                      <span style={{ fontWeight: 700, color: "var(--text-strong)" }}>
                        {item.plan?.name ?? "Unassigned Tier"}
                      </span>
                      {item.plan?.monthly_price && (
                        <small style={{ color: "var(--muted)", fontSize: "0.72rem" }}>
                          {Number(item.plan.monthly_price).toFixed(2)} / mo
                        </small>
                      )}
                    </div>
                  </td>

                  {/* Status Column */}
                  <td>
                    <StatusBadge status={item.status} />
                  </td>

                  {/* Starts Column */}
                  <td>
                    <span style={{ fontSize: "0.78rem" }}>
                      {item.starts_at ? new Date(item.starts_at).toLocaleDateString() : "—"}
                    </span>
                  </td>

                  {/* Ends Column */}
                  <td>
                    <span style={{ fontSize: "0.78rem", color: item.ends_at ? "var(--warn)" : "var(--muted)" }}>
                      {item.ends_at ? new Date(item.ends_at).toLocaleDateString() : "Active Ongoing"}
                    </span>
                  </td>

                  {/* Switch Tier Column */}
                  <td style={{ textAlign: "right" }}>
                    <select
                      value={item.plan?.id ?? ""}
                      onChange={(e) => {
                        if (item.store) {
                          changeSubscription.mutate({
                            storeId: item.store.id,
                            planId: e.target.value,
                          });
                        }
                      }}
                      disabled={changeSubscription.isPending}
                      style={{
                        padding: "0.3rem 0.55rem",
                        fontSize: "0.75rem",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--line)",
                        background: "var(--panel-2)",
                        color: "var(--text-strong)",
                        cursor: "pointer",
                      }}
                      aria-label={`Change plan tier for ${item.store?.name ?? "store"}`}
                    >
                      <option value="" disabled>
                        Switch tier…
                      </option>
                      {planList
                        .filter((p) => p.platform_status === "active")
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({Number(p.monthly_price).toFixed(2)}/mo)
                          </option>
                        ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {subscriptions.isLoading && (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
              Loading multi-tenant subscription ledger…
            </div>
          )}

          {!subscriptions.isLoading && filteredSubs.length === 0 && (
            <EmptyState
              title="No subscriptions found"
              hint="Use 'Assign Tenant Plan' to attach an active commercial plan to a store."
            />
          )}
        </div>
      </section>

      {/* Plan Create / Edit Modal */}
      {planOpen && (
        <PlatformModal
          title={editingPlanId ? "Edit Commercial Tier" : "Create New Commercial Tier"}
          description="Define tier pricing and resource limits across users, registers, and branches."
          onClose={() => setPlanOpen(false)}
        >
          <form
            className="platform-form"
            onSubmit={(e) => {
              e.preventDefault();
              savePlan.mutate();
            }}
          >
            <Field id="plan-name" label="Tier Name">
              <input
                id="plan-name"
                value={planForm.name}
                onChange={(e) => {
                  const name = e.target.value;
                  const autoSlug = editingPlanId
                    ? planForm.slug
                    : name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
                  setPlanForm({ ...planForm, name, slug: autoSlug });
                }}
                placeholder="e.g. Professional Retail"
                required
              />
            </Field>

            <Field id="plan-slug" label="Identifier Slug (Unique URL identifier)">
              <input
                id="plan-slug"
                value={planForm.slug}
                onChange={(e) => setPlanForm({ ...planForm, slug: e.target.value })}
                placeholder="e.g. professional-retail"
                required
              />
            </Field>

            <Field id="plan-price" label="Monthly Subscription Price">
              <input
                id="plan-price"
                type="number"
                min="0"
                step="0.01"
                value={planForm.monthly_price}
                onChange={(e) => setPlanForm({ ...planForm, monthly_price: e.target.value })}
                placeholder="e.g. 150.00"
                required
              />
            </Field>

            <Field id="plan-desc" label="Description & Entitlements">
              <input
                id="plan-desc"
                value={planForm.description}
                onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                placeholder="e.g. Suitable for multi-register retail outlets with inventory tracking"
              />
            </Field>

            <Field id="plan-limits" label="Resource Limits JSON (Users, Devices, Outlets)">
              <textarea
                id="plan-limits"
                rows={5}
                value={planForm.limits}
                onChange={(e) => setPlanForm({ ...planForm, limits: e.target.value })}
                placeholder='{"users": 10, "devices": 3, "branches": 2}'
              />
            </Field>

            <div className="platform-modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPlanOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="pay-button"
                disabled={savePlan.isPending}
              >
                {savePlan.isPending ? "Saving Tier…" : editingPlanId ? "Update Tier" : "Create Tier"}
              </button>
            </div>
          </form>
        </PlatformModal>
      )}

      {/* Plan Assignment Modal */}
      {assignOpen && (
        <PlatformModal
          title="Assign Plan to Tenant Store"
          description="Provision or upgrade a store's commercial tier subscription."
          onClose={() => setAssignOpen(false)}
        >
          <form
            className="platform-form"
            onSubmit={(e) => {
              e.preventDefault();
              assignPlan.mutate();
            }}
          >
            <Field id="as-store" label="Select Store Tenant">
              <select
                id="as-store"
                value={assign.storeId}
                onChange={(e) => setAssign({ ...assign, storeId: e.target.value })}
                required
              >
                <option value="">Choose a store…</option>
                {storeList.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name} {store.platform_status ? `(${store.platform_status})` : ""}
                  </option>
                ))}
              </select>
            </Field>

            <Field id="as-plan" label="Select Plan Tier">
              <select
                id="as-plan"
                value={assign.planId}
                onChange={(e) => setAssign({ ...assign, planId: e.target.value })}
                required
              >
                <option value="">Choose a plan tier…</option>
                {planList
                  .filter((p) => p.platform_status === "active")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {Number(p.monthly_price).toFixed(2)} / month
                    </option>
                  ))}
              </select>
            </Field>

            <div className="platform-modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setAssignOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="pay-button"
                disabled={assignPlan.isPending}
              >
                {assignPlan.isPending ? "Assigning Tier…" : "Confirm Plan Assignment"}
              </button>
            </div>
          </form>
        </PlatformModal>
      )}
    </PlatformPage>
  );
}
