import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, CheckCircle2, Plus, ShieldCheck } from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";

type BranchRecord = {
  id: string;
  name: string;
  platform_status: "active" | "suspended" | "inactive";
  parent_store: { id: string; name: string } | null;
  owner: { id: string; name: string; email: string } | null;
  members_count: number;
  orders_count: number;
  created_at: string | null;
};

type StoreOption = { id: string; name: string };

export function BranchesPage() {
  const isSuperAdmin = useSession((s) => s.user?.is_super_admin ?? false);
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    parent_store_id: "",
    owner_user_id: "",
    currency: "GHS",
    timezone: "Africa/Accra",
    platform_status: "active" as BranchRecord["platform_status"],
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const branches = useQuery({
    queryKey: ["admin-branches"],
    queryFn: async () => (await api.get<{ data: BranchRecord[] }>("/api/admin/branches", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const parentStores = useQuery({
    queryKey: ["admin-store-options"],
    queryFn: async () => {
      const response = await api.get<{ data: StoreOption[] }>("/api/admin/stores", undefined, { storeless: true });
      return (response.data ?? []).map((store) => ({ id: store.id, name: store.name }));
    },
    enabled: isSuperAdmin,
  });

  const saveBranch = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        parent_store_id: form.parent_store_id,
        owner_user_id: form.owner_user_id || undefined,
        currency: form.currency || "GHS",
        timezone: form.timezone || "Africa/Accra",
        platform_status: form.platform_status,
      };

      if (editingId) {
        return api.patch(`/api/admin/branches/${editingId}`, payload, { storeless: true });
      }

      return api.post("/api/admin/branches", payload, { storeless: true });
    },
    onSuccess: () => {
      setForm({ name: "", parent_store_id: "", owner_user_id: "", currency: "GHS", timezone: "Africa/Accra", platform_status: "active" });
      setEditingId(null);
      setError(null);
      setToast(editingId ? "Branch updated." : "Branch created.");
      void queryClient.invalidateQueries({ queryKey: ["admin-branches"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-store-options"] });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not save the branch."),
  });

  const deleteBranch = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/branches/${id}`, { storeless: true }),
    onSuccess: () => {
      setToast("Branch deleted.");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-branches"] });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not delete the branch."),
  });

  const resetForm = () => {
    setForm({ name: "", parent_store_id: "", owner_user_id: "", currency: "GHS", timezone: "Africa/Accra", platform_status: "active" });
    setEditingId(null);
    setError(null);
  };

  if (!isSuperAdmin) {
    return (
      <div className="page">
        <h1><ShieldCheck size={20} /> Branches</h1>
        <p className="notice notice-warn">This area is limited to platform administrators.</p>
      </div>
    );
  }

  return (
    <div className="page platform-page">
      <header className="page-header">
        <div>
          <h1><Boxes size={20} /> Branches</h1>
          <p className="muted">Platform-level branch visibility and status. Operational branch data stays with the store.</p>
        </div>
        <span className="platform-scope-badge"><ShieldCheck size={14} /> Platform only</span>
      </header>

      {toast && <p className="platform-toast" role="status"><CheckCircle2 size={16} />{toast}</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}

      <section className="platform-panel">
        <div className="platform-section-heading">
          <div><h2>{editingId ? "Edit branch" : "Create branch"}</h2><p>Keep branch records attached to their parent store.</p></div>
        </div>

        <form className="platform-resource-form platform-setting-form" onSubmit={(event) => { event.preventDefault(); saveBranch.mutate(); }}>
          <input placeholder="Branch name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          <select value={form.parent_store_id} onChange={(event) => setForm({ ...form, parent_store_id: event.target.value })} required>
            <option value="">Select parent store</option>
            {(parentStores.data ?? []).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
          <input placeholder="Owner user id" value={form.owner_user_id} onChange={(event) => setForm({ ...form, owner_user_id: event.target.value })} />
          <div className="platform-two-column" style={{ marginTop: 0 }}>
            <input placeholder="Currency" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })} />
            <input placeholder="Timezone" value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />
          </div>
          <select value={form.platform_status} onChange={(event) => setForm({ ...form, platform_status: event.target.value as BranchRecord["platform_status"] })}>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="inactive">Inactive</option>
          </select>
          <div className="platform-row-actions">
            <button type="submit" className="secondary-button" disabled={saveBranch.isPending}><Plus size={15} /> {editingId ? "Save changes" : "Create branch"}</button>
            {editingId && <button type="button" className="secondary-button secondary-button-muted" onClick={resetForm}>Cancel</button>}
          </div>
        </form>
      </section>

      <section className="platform-panel">
        <div className="platform-section-heading">
          <div>
            <h2>All branches</h2>
            <p>Track branch ownership, status, and operational usage.</p>
          </div>
          <span className="platform-panel-count">{branches.data?.length ?? 0}</span>
        </div>

        <table className="table">
          <thead>
            <tr><th>Branch</th><th>Parent store</th><th>Status</th><th>Owner</th><th>Staff</th><th>Orders</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {(branches.data ?? []).map((branch) => (
              <tr key={branch.id}>
                <td>{branch.name}</td>
                <td>{branch.parent_store?.name ?? "—"}</td>
                <td><span className={`platform-status platform-status-${branch.platform_status}`}>{branch.platform_status}</span></td>
                <td>{branch.owner?.name ?? "—"}</td>
                <td>{branch.members_count}</td>
                <td>{branch.orders_count}</td>
                <td className="platform-row-actions">
                  <button type="button" className="icon-button" onClick={() => {
                    setEditingId(branch.id);
                    setForm({
                      name: branch.name,
                      parent_store_id: branch.parent_store?.id ?? "",
                      owner_user_id: branch.owner?.id ?? "",
                      currency: "GHS",
                      timezone: "Africa/Accra",
                      platform_status: branch.platform_status,
                    });
                  }}>Edit</button>
                  <button type="button" className="icon-button danger" onClick={() => deleteBranch.mutate(branch.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {branches.isLoading && <p className="muted">Loading branches…</p>}
        {!branches.isLoading && (branches.data ?? []).length === 0 && <p className="muted">No branch records found.</p>}
      </section>
    </div>
  );
}
