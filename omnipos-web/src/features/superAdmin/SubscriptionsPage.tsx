import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt } from "lucide-react";

import { api } from "@/api/client";
import {
  EmptyState,
  Field,
  PlatformDenied,
  PlatformModal,
  PlatformPage,
  PlatformToast,
  SearchField,
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

type StoreOption = { id: string; name: string };

const emptyPlan = { name: "", slug: "", description: "", monthly_price: "", limits: '{"users":10}' };

export function SubscriptionsPage() {
  const isSuperAdmin = usePlatformAccess();
  const queryClient = useQueryClient();
  const { toast, setToast } = useToast();
  const [query, setQuery] = useState("");
  const [planOpen, setPlanOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState(emptyPlan);
  const [assign, setAssign] = useState({ storeId: "", planId: "" });

  const plans = useQuery({
    queryKey: ["admin-plans-page"],
    queryFn: async () => (await api.get<{ data: PlanRow[] }>("/api/admin/plans", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const subscriptions = useQuery({
    queryKey: ["admin-subscriptions-page"],
    queryFn: async () => (await api.get<{ data: SubscriptionRow[] }>("/api/admin/subscriptions", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const stores = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => (await api.get<{ data: StoreOption[] }>("/api/admin/stores", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin && assignOpen,
  });

  const savePlan = useMutation({
    mutationFn: () => {
      const payload = {
        name: planForm.name,
        slug: planForm.slug,
        description: planForm.description || null,
        monthly_price: Number(planForm.monthly_price || 0),
        limits: planForm.limits ? JSON.parse(planForm.limits) : {},
      };
      if (editingPlanId) return api.patch(`/api/admin/plans/${editingPlanId}`, payload, { storeless: true });
      return api.post("/api/admin/plans", payload, { storeless: true });
    },
    onSuccess: () => {
      setPlanForm(emptyPlan);
      setEditingPlanId(null);
      setPlanOpen(false);
      setToast(editingPlanId ? "Plan updated." : "Plan created.");
      void queryClient.invalidateQueries({ queryKey: ["admin-plans-page"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not save the plan. Check the limits JSON."),
  });

  const archivePlan = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/plans/${id}`, { storeless: true }),
    onSuccess: () => {
      setToast("Plan archived.");
      void queryClient.invalidateQueries({ queryKey: ["admin-plans-page"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not archive the plan."),
  });

  const assignPlan = useMutation({
    mutationFn: () => api.post(`/api/admin/stores/${assign.storeId}/subscription`, { plan_id: assign.planId }, { storeless: true }),
    onSuccess: () => {
      setAssignOpen(false);
      setAssign({ storeId: "", planId: "" });
      setToast("Subscription assigned.");
      void queryClient.invalidateQueries({ queryKey: ["admin-subscriptions-page"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not assign the plan."),
  });

  const changeSubscription = useMutation({
    mutationFn: ({ storeId, planId }: { storeId: string; planId: string }) =>
      api.post(`/api/admin/stores/${storeId}/subscription`, { plan_id: planId }, { storeless: true }),
    onSuccess: () => {
      setToast("Subscription updated.");
      void queryClient.invalidateQueries({ queryKey: ["admin-subscriptions-page"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not update the subscription."),
  });

  const filteredSubs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (subscriptions.data ?? []).filter((item) =>
      `${item.store?.name ?? ""} ${item.plan?.name ?? ""} ${item.status}`.toLowerCase().includes(needle),
    );
  }, [subscriptions.data, query]);

  if (!isSuperAdmin) return <PlatformDenied title="Billing" />;

  return (
    <PlatformPage
      icon={Receipt}
      title="Billing"
      description="Define commercial plans and assign them to stores. This is the platform-to-tenant relationship, not a till sale."
      actions={
        <>
          <button type="button" className="secondary-button" onClick={() => setAssignOpen(true)}>Assign plan</button>
          <button type="button" className="pay-button" onClick={() => { setEditingPlanId(null); setPlanForm(emptyPlan); setPlanOpen(true); }}>
            <Plus size={16} /> New plan
          </button>
        </>
      }
    >
      <PlatformToast message={toast} />

      <div className="platform-plan-grid">
        {(plans.data ?? []).map((plan) => (
          <article className="platform-plan-card" key={plan.id}>
            <header>
              <div>
                <strong>{plan.name}</strong>
                <small>{plan.slug}</small>
              </div>
              <StatusBadge status={plan.platform_status} />
            </header>
            <p className="platform-plan-price">{plan.monthly_price} <span>/ month</span></p>
            <p className="muted">{plan.description || "No description"}</p>
            <p className="muted">{plan.subscriptions_count} store{plan.subscriptions_count === 1 ? "" : "s"}</p>
            <div className="platform-row-actions">
              <button type="button" className="icon-button" onClick={() => {
                setEditingPlanId(plan.id);
                setPlanForm({
                  name: plan.name,
                  slug: plan.slug,
                  description: plan.description ?? "",
                  monthly_price: String(plan.monthly_price),
                  limits: JSON.stringify(plan.limits ?? {}, null, 2),
                });
                setPlanOpen(true);
              }}>Edit</button>
              {plan.platform_status !== "archived" && (
                <button type="button" className="icon-button danger-button" onClick={() => {
                  if (window.confirm(`Archive ${plan.name}?`)) archivePlan.mutate(plan.id);
                }}>Archive</button>
              )}
            </div>
          </article>
        ))}
        {!plans.isLoading && (plans.data ?? []).length === 0 && (
          <EmptyState title="No plans yet" hint="Create a commercial plan before assigning stores." />
        )}
      </div>

      <section className="platform-panel">
        <div className="platform-toolbar">
          <h2>Store subscriptions</h2>
          <SearchField value={query} onChange={setQuery} placeholder="Search stores or plans" />
          <span className="platform-panel-count">{filteredSubs.length}</span>
        </div>
        <table className="table">
          <thead>
            <tr><th>Store</th><th>Plan</th><th>Status</th><th>Starts</th><th>Ends</th><th>Change plan</th></tr>
          </thead>
          <tbody>
            {filteredSubs.map((item) => (
              <tr key={item.id}>
                <td>{item.store?.name ?? "—"}</td>
                <td>{item.plan?.name ?? "—"}</td>
                <td><StatusBadge status={item.status} /></td>
                <td>{item.starts_at ? new Date(item.starts_at).toLocaleDateString() : "—"}</td>
                <td>{item.ends_at ? new Date(item.ends_at).toLocaleDateString() : "—"}</td>
                <td>
                  <select
                    value={item.plan?.id ?? ""}
                    onChange={(e) => {
                      if (item.store) changeSubscription.mutate({ storeId: item.store.id, planId: e.target.value });
                    }}
                    aria-label={`Change plan for ${item.store?.name ?? "store"}`}
                  >
                    <option value="" disabled>Choose plan</option>
                    {(plans.data ?? []).filter((plan) => plan.platform_status === "active").map((plan) => (
                      <option key={plan.id} value={plan.id}>{plan.name}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!subscriptions.isLoading && filteredSubs.length === 0 && <EmptyState title="No subscriptions" hint="Assign a plan to a store to start billing coverage." />}
      </section>

      {planOpen && (
        <PlatformModal title={editingPlanId ? "Edit plan" : "New plan"} onClose={() => setPlanOpen(false)}>
          <form className="platform-form" onSubmit={(e) => { e.preventDefault(); savePlan.mutate(); }}>
            <Field id="plan-name" label="Name">
              <input id="plan-name" value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} required />
            </Field>
            <Field id="plan-slug" label="Slug">
              <input id="plan-slug" value={planForm.slug} onChange={(e) => setPlanForm({ ...planForm, slug: e.target.value })} required />
            </Field>
            <Field id="plan-price" label="Monthly price">
              <input id="plan-price" type="number" min="0" step="0.01" value={planForm.monthly_price} onChange={(e) => setPlanForm({ ...planForm, monthly_price: e.target.value })} required />
            </Field>
            <Field id="plan-desc" label="Description">
              <input id="plan-desc" value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} />
            </Field>
            <Field id="plan-limits" label="Limits JSON">
              <textarea id="plan-limits" rows={5} value={planForm.limits} onChange={(e) => setPlanForm({ ...planForm, limits: e.target.value })} />
            </Field>
            <div className="platform-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setPlanOpen(false)}>Cancel</button>
              <button type="submit" className="pay-button" disabled={savePlan.isPending}>Save plan</button>
            </div>
          </form>
        </PlatformModal>
      )}

      {assignOpen && (
        <PlatformModal title="Assign a plan" onClose={() => setAssignOpen(false)}>
          <form className="platform-form" onSubmit={(e) => { e.preventDefault(); assignPlan.mutate(); }}>
            <Field id="as-store" label="Store">
              <select id="as-store" value={assign.storeId} onChange={(e) => setAssign({ ...assign, storeId: e.target.value })} required>
                <option value="">Select store</option>
                {(stores.data ?? []).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </Field>
            <Field id="as-plan" label="Plan">
              <select id="as-plan" value={assign.planId} onChange={(e) => setAssign({ ...assign, planId: e.target.value })} required>
                <option value="">Select plan</option>
                {(plans.data ?? []).filter((plan) => plan.platform_status === "active").map((plan) => (
                  <option key={plan.id} value={plan.id}>{plan.name}</option>
                ))}
              </select>
            </Field>
            <div className="platform-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setAssignOpen(false)}>Cancel</button>
              <button type="submit" className="pay-button" disabled={assignPlan.isPending}>Assign</button>
            </div>
          </form>
        </PlatformModal>
      )}
    </PlatformPage>
  );
}
