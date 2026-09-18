import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt, ShieldCheck } from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";

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
  platform_status: string;
  subscriptions_count: number;
};

export function SubscriptionsPage() {
  const isSuperAdmin = useSession((s) => s.user?.is_super_admin ?? false);
  const queryClient = useQueryClient();
  const [planForm, setPlanForm] = useState({ name: "", slug: "", description: "", monthly_price: "", limits: "" });
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);

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

  const savePlan = useMutation({
    mutationFn: () => {
      const payload = {
        name: planForm.name,
        slug: planForm.slug,
        description: planForm.description || null,
        monthly_price: Number(planForm.monthly_price || 0),
        limits: planForm.limits ? JSON.parse(planForm.limits) : {},
      };

      if (editingPlanId) {
        return api.patch(`/api/admin/plans/${editingPlanId}`, payload, { storeless: true });
      }

      return api.post("/api/admin/plans", payload, { storeless: true });
    },
    onSuccess: () => {
      setPlanForm({ name: "", slug: "", description: "", monthly_price: "", limits: "" });
      setEditingPlanId(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-plans-page"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-subscriptions-page"] });
    },
  });

  const deletePlan = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/plans/${id}`, { storeless: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-plans-page"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-subscriptions-page"] });
    },
  });

  if (!isSuperAdmin) {
    return (<div className="page"><h1><ShieldCheck size={20} /> Subscriptions</h1><p className="notice notice-warn">This area is limited to platform administrators.</p></div>);
  }

  return (
    <div className="page platform-page">
      <header className="page-header">
        <div>
          <h1><Receipt size={20} /> Subscriptions</h1>
          <p className="muted">Manage plan catalogues and watch store plan assignment without exposing store operations.</p>
        </div>
        <span className="platform-scope-badge"><ShieldCheck size={14} /> Platform only</span>
      </header>

      <section className="platform-panel">
        <div className="platform-section-heading">
          <div><h2>Plan catalogue</h2><p>Create, edit, and archive plans used by stores.</p></div>
          <span className="platform-panel-count">{plans.data?.length ?? 0}</span>
        </div>

        <form className="platform-plan-form" onSubmit={(event) => { event.preventDefault(); savePlan.mutate(); }}>
          <input placeholder="Plan name" value={planForm.name} onChange={(event) => setPlanForm({ ...planForm, name: event.target.value })} required />
          <input placeholder="Slug" value={planForm.slug} onChange={(event) => setPlanForm({ ...planForm, slug: event.target.value })} required />
          <input type="number" min="0" step="0.01" placeholder="Monthly price" value={planForm.monthly_price} onChange={(event) => setPlanForm({ ...planForm, monthly_price: event.target.value })} required />
          <input placeholder='Limits JSON, e.g. {"users":10}' value={planForm.limits} onChange={(event) => setPlanForm({ ...planForm, limits: event.target.value })} />
          <button type="submit" className="secondary-button" disabled={savePlan.isPending}><Plus size={15} /> {editingPlanId ? "Save" : "Create"}</button>
        </form>

        <div className="platform-plan-list">
          {(plans.data ?? []).map((plan) => (
            <div className="platform-plan-row" key={plan.id}>
              <span>
                <strong>{plan.name}</strong>
                <small>{plan.slug} · {plan.monthly_price} / mo · {plan.subscriptions_count} active</small>
              </span>
              <div className="platform-row-actions">
                <button type="button" className="icon-button" onClick={() => { setEditingPlanId(plan.id); setPlanForm({ name: plan.name, slug: plan.slug, description: plan.description ?? "", monthly_price: String(plan.monthly_price), limits: typeof plan === "object" ? JSON.stringify({}) : "" }); }} aria-label={`Edit ${plan.name}`}>Edit</button>
                <button type="button" className="icon-button danger" onClick={() => deletePlan.mutate(plan.id)} aria-label={`Delete ${plan.name}`}>Delete</button>
                <b className={`platform-status-${plan.platform_status === "active" ? "active" : "inactive"}`}>{plan.platform_status}</b>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="platform-panel">
        <div className="platform-section-heading">
          <div><h2>Subscriptions</h2><p>Plan allocation and active status for each store.</p></div>
          <span className="platform-panel-count">{subscriptions.data?.length ?? 0}</span>
        </div>

        <table className="table">
          <thead>
            <tr><th>Store</th><th>Plan</th><th>Status</th><th>Starts</th><th>Ends</th></tr>
          </thead>
          <tbody>
            {(subscriptions.data ?? []).map((item) => (
              <tr key={item.id}>
                <td>{item.store?.name ?? "—"}</td>
                <td>{item.plan?.name ?? "—"}</td>
                <td><span className={`platform-status platform-status-${item.status === "active" ? "active" : "inactive"}`}>{item.status}</span></td>
                <td>{item.starts_at ? new Date(item.starts_at).toLocaleDateString() : "—"}</td>
                <td>{item.ends_at ? new Date(item.ends_at).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
