import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus, ShieldCheck, Store } from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";

type StoreRow = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  platform_status: "active" | "suspended" | "inactive";
  members_count: number;
  orders_count: number;
  owner: { id: string; name: string; email: string } | null;
};

export function StoresPage() {
  const isSuperAdmin = useSession((s) => s.user?.is_super_admin ?? false);
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    owner_user_id: "",
    currency: "GHS",
    timezone: "Africa/Accra",
    platform_status: "active" as StoreRow["platform_status"],
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stores = useQuery({
    queryKey: ["admin-stores-page"],
    queryFn: async () => (await api.get<{ data: StoreRow[] }>('/api/admin/stores', undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const saveStore = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        owner_user_id: form.owner_user_id || undefined,
        currency: form.currency || "GHS",
        timezone: form.timezone || "Africa/Accra",
        platform_status: form.platform_status,
      };

      if (editingId) {
        return api.patch(`/api/admin/stores/${editingId}`, payload, { storeless: true });
      }

      return api.post(
        "/api/admin/stores",
        {
          store_name: payload.name,
          admin_email: `store-admin-${Date.now()}@platform.local`,
          admin_password: "Password123!",
          currency: payload.currency,
          timezone: payload.timezone,
        },
        { storeless: true },
      );
    },
    onSuccess: () => {
      setForm({ name: "", owner_user_id: "", currency: "GHS", timezone: "Africa/Accra", platform_status: "active" });
      setEditingId(null);
      setError(null);
      setToast(editingId ? "Store updated." : "Store created.");
      void queryClient.invalidateQueries({ queryKey: ["admin-stores-page"] });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not save the store."),
  });

  const deleteStore = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/stores/${id}`, { storeless: true }),
    onSuccess: () => {
      setToast("Store deleted.");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-stores-page"] });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not delete the store."),
  });

  const resetForm = () => {
    setForm({ name: "", owner_user_id: "", currency: "GHS", timezone: "Africa/Accra", platform_status: "active" });
    setEditingId(null);
    setError(null);
  };

  if (!isSuperAdmin) {
    return (<div className="page"><h1><ShieldCheck size={20} /> Stores</h1><p className="notice notice-warn">This area is limited to platform administrators.</p></div>);
  }

  return (
    <div className="page platform-page">
      <header className="page-header">
        <div>
          <h1><Store size={20} /> Stores</h1>
          <p className="muted">Create, update, and retire stores across the platform. Store operational management remains outside this scope.</p>
        </div>
        <span className="platform-scope-badge"><ShieldCheck size={14} /> Platform only</span>
      </header>

      {toast && <p className="platform-toast" role="status"><CheckCircle2 size={16} />{toast}</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}

      <section className="platform-panel">
        <div className="platform-section-heading">
          <div><h2>{editingId ? "Edit store" : "Create store"}</h2><p>Platform record management for tenant stores.</p></div>
        </div>

        <form className="platform-resource-form platform-setting-form" onSubmit={(event) => { event.preventDefault(); saveStore.mutate(); }}>
          <input placeholder="Store name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          <input placeholder="Owner user id" value={form.owner_user_id} onChange={(event) => setForm({ ...form, owner_user_id: event.target.value })} />
          <div className="platform-two-column" style={{ marginTop: 0 }}>
            <input placeholder="Currency" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })} />
            <input placeholder="Timezone" value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />
          </div>
          <select value={form.platform_status} onChange={(event) => setForm({ ...form, platform_status: event.target.value as StoreRow['platform_status'] })}>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="inactive">Inactive</option>
          </select>
          <div className="platform-row-actions">
            <button type="submit" className="secondary-button" disabled={saveStore.isPending}><Plus size={15} /> {editingId ? "Save changes" : "Create store"}</button>
            {editingId && <button type="button" className="secondary-button secondary-button-muted" onClick={resetForm}>Cancel</button>}
          </div>
        </form>
      </section>

      <section className="platform-panel">
        <div className="platform-section-heading">
          <div><h2>All stores</h2><p>Operational metrics and platform lifecycle controls.</p></div>
          <span className="platform-panel-count">{stores.data?.length ?? 0}</span>
        </div>

        <table className="table">
          <thead>
            <tr><th>Store</th><th>Status</th><th>Owner</th><th>Staff</th><th>Orders</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {(stores.data ?? []).map((store) => (
              <tr key={store.id}>
                <td>{store.name}<div className="muted">{store.currency} · {store.timezone}</div></td>
                <td><span className={`platform-status platform-status-${store.platform_status}`}>{store.platform_status}</span></td>
                <td>{store.owner?.name ?? "—"}</td>
                <td>{store.members_count}</td>
                <td>{store.orders_count}</td>
                <td className="platform-row-actions">
                  <button type="button" className="icon-button" onClick={() => { setEditingId(store.id); setForm({ name: store.name, owner_user_id: store.owner?.id ?? "", currency: store.currency, timezone: store.timezone, platform_status: store.platform_status }); }}>Edit</button>
                  <button type="button" className="icon-button danger" onClick={() => deleteStore.mutate(store.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {stores.isLoading && <p className="muted">Loading stores…</p>}
        {!stores.isLoading && (stores.data ?? []).length === 0 && <p className="muted">No store records found.</p>}
      </section>
    </div>
  );
}
