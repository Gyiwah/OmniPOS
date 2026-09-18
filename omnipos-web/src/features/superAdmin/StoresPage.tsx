import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus, Store } from "lucide-react";

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

type SystemStore = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  members_count: number;
  orders_count: number;
  owner: { id: string; name: string; email: string } | null;
  platform_status: "active" | "suspended" | "inactive";
  parent_store_id: string | null;
};

type PlatformMember = { id: string; role: string; user: { name: string; email: string } | null };

type Provisioned = {
  store: { id: string; name: string };
  admin: { name: string; email: string };
  account_created: boolean;
};

const emptyForm = {
  store_name: "",
  currency: "GHS",
  timezone: "Africa/Accra",
  admin_name: "",
  admin_email: "",
  admin_password: "",
};

export function StoresPage() {
  const isSuperAdmin = usePlatformAccess();
  const queryClient = useQueryClient();
  const { toast, setToast } = useToast();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [edit, setEdit] = useState<SystemStore | null>(null);
  const [editForm, setEditForm] = useState({ name: "", currency: "", timezone: "", platform_status: "active" as SystemStore["platform_status"] });
  const [membersFor, setMembersFor] = useState<SystemStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Provisioned | null>(null);

  const stores = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => (await api.get<{ data: SystemStore[] }>("/api/admin/stores", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const members = useQuery({
    queryKey: ["admin-members", membersFor?.id],
    queryFn: async () => (await api.get<{ data: PlatformMember[] }>(`/api/admin/stores/${membersFor?.id}/members`, undefined, { storeless: true })).data ?? [],
    enabled: Boolean(membersFor),
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
      setToast(`${res.store.name} is ready.`);
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: ["admin-stores"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not create the store."),
  });

  const saveStore = useMutation({
    mutationFn: () => {
      if (!edit) throw new Error("No store selected.");
      return api.patch(`/api/admin/stores/${edit.id}`, {
        name: editForm.name.trim(),
        currency: editForm.currency,
        timezone: editForm.timezone,
        platform_status: editForm.platform_status,
      }, { storeless: true });
    },
    onSuccess: () => {
      setEdit(null);
      setToast("Store updated.");
      void queryClient.invalidateQueries({ queryKey: ["admin-stores"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not update the store."),
  });

  const changeStatus = useMutation({
    mutationFn: ({ storeId, status }: { storeId: string; status: SystemStore["platform_status"] }) =>
      api.patch(`/api/admin/stores/${storeId}/status`, { status }, { storeless: true }),
    onSuccess: () => {
      setToast("Store status updated.");
      void queryClient.invalidateQueries({ queryKey: ["admin-stores"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not update store status."),
  });

  const deleteStore = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/stores/${id}`, { storeless: true }),
    onSuccess: () => {
      setToast("Store deleted.");
      void queryClient.invalidateQueries({ queryKey: ["admin-stores"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not delete the store."),
  });

  const rows = useMemo(() => {
    const list = (stores.data ?? []).filter((store) => !store.parent_store_id);
    return list.filter((store) => {
      const hay = `${store.name} ${store.owner?.email ?? ""} ${store.currency}`.toLowerCase();
      const matchesQuery = hay.includes(query.trim().toLowerCase());
      const matchesStatus = statusFilter === "all" || store.platform_status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [stores.data, query, statusFilter]);

  if (!isSuperAdmin) return <PlatformDenied title="Stores" />;

  return (
    <PlatformPage
      icon={Store}
      title="Stores"
      description="Provision a tenant with its first administrator in one step. Status here is platform lifecycle, not till operations."
      actions={
        <button type="button" className="pay-button" onClick={() => { setProvisionOpen(true); setResult(null); setError(null); }}>
          <Plus size={16} /> New store
        </button>
      }
    >
      <PlatformToast message={toast} />

      <section className="platform-panel">
        <div className="platform-toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Search stores or owners" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="inactive">Inactive</option>
          </select>
          <span className="platform-panel-count">{rows.length}</span>
        </div>

        <table className="table">
          <thead>
            <tr><th>Store</th><th>Status</th><th>Owner</th><th>Staff</th><th>Sales</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((store) => (
              <tr key={store.id}>
                <td>
                  <strong>{store.name}</strong>
                  <div className="muted">{store.currency} · {store.timezone}</div>
                </td>
                <td><StatusBadge status={store.platform_status} /></td>
                <td>
                  {store.owner?.name ?? "—"}
                  {store.owner && <div className="muted mono">{store.owner.email}</div>}
                </td>
                <td>{store.members_count}</td>
                <td className={store.orders_count === 0 ? "muted" : undefined}>
                  {store.orders_count === 0 ? "Never used" : store.orders_count}
                </td>
                <td className="platform-row-actions">
                  <button type="button" className="icon-button" onClick={() => setMembersFor(store)} aria-label={`Members of ${store.name}`}>
                    <Eye size={16} />
                  </button>
                  <button type="button" className="icon-button" onClick={() => {
                    setEdit(store);
                    setEditForm({ name: store.name, currency: store.currency, timezone: store.timezone, platform_status: store.platform_status });
                  }}>Edit</button>
                  <select
                    value={store.platform_status}
                    onChange={(e) => changeStatus.mutate({ storeId: store.id, status: e.target.value as SystemStore["platform_status"] })}
                    aria-label={`Change status for ${store.name}`}
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="inactive">Inactive</option>
                  </select>
                  <button
                    type="button"
                    className="icon-button danger-button"
                    onClick={() => {
                      if (window.confirm(`Delete ${store.name}? This cannot be undone.`)) deleteStore.mutate(store.id);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {stores.isLoading && <p className="muted">Loading stores…</p>}
        {!stores.isLoading && rows.length === 0 && (
          <EmptyState title="No stores match" hint="Provision a tenant or clear the filters." />
        )}
        {stores.error && <p className="notice notice-warn">{stores.error instanceof Error ? stores.error.message : "Could not load stores."}</p>}
      </section>

      {provisionOpen && (
        <PlatformModal
          title="Provision a store"
          description="The store and its admin are created together so the tenant is never left without an operator."
          onClose={() => setProvisionOpen(false)}
        >
          {result && (
            <p className="notice notice-ok" role="status">
              {result.store.name} created.{" "}
              {result.account_created
                ? `A new login was made for ${result.admin.email} — give them the password you set.`
                : `${result.admin.email} already had a login, and it now has access. They keep their existing password.`}
            </p>
          )}
          {error && <p className="notice notice-error">{error}</p>}
          <form
            className="platform-form"
            onSubmit={(e) => {
              e.preventDefault();
              setResult(null);
              provision.mutate();
            }}
          >
            <Field id="sa-store" label="Store name">
              <input id="sa-store" value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} required />
            </Field>
            <div className="platform-form-grid">
              <Field id="sa-currency" label="Currency">
                <input id="sa-currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
              </Field>
              <Field id="sa-tz" label="Timezone">
                <input id="sa-tz" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
              </Field>
            </div>
            <h3 className="platform-subheading">Who will run it</h3>
            <div className="platform-form-grid">
              <Field id="sa-admin-name" label="Name">
                <input id="sa-admin-name" value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} />
              </Field>
              <Field id="sa-admin-email" label="Email">
                <input id="sa-admin-email" type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} required />
              </Field>
            </div>
            <Field id="sa-admin-password" label="Password">
              <input id="sa-admin-password" type="password" value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} autoComplete="new-password" />
            </Field>
            <p className="muted">Only needed if this email has no account yet. An existing login keeps its password.</p>
            <div className="platform-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setProvisionOpen(false)}>Close</button>
              <button type="submit" className="pay-button" disabled={provision.isPending}>
                {provision.isPending ? "Creating…" : "Create store and admin"}
              </button>
            </div>
          </form>
        </PlatformModal>
      )}

      {edit && (
        <PlatformModal title={`Edit ${edit.name}`} onClose={() => setEdit(null)}>
          <form className="platform-form" onSubmit={(e) => { e.preventDefault(); saveStore.mutate(); }}>
            <Field id="edit-name" label="Name">
              <input id="edit-name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            </Field>
            <div className="platform-form-grid">
              <Field id="edit-currency" label="Currency">
                <input id="edit-currency" value={editForm.currency} onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })} />
              </Field>
              <Field id="edit-tz" label="Timezone">
                <input id="edit-tz" value={editForm.timezone} onChange={(e) => setEditForm({ ...editForm, timezone: e.target.value })} />
              </Field>
            </div>
            <Field id="edit-status" label="Status">
              <select id="edit-status" value={editForm.platform_status} onChange={(e) => setEditForm({ ...editForm, platform_status: e.target.value as SystemStore["platform_status"] })}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
            <div className="platform-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEdit(null)}>Cancel</button>
              <button type="submit" className="pay-button" disabled={saveStore.isPending}>Save changes</button>
            </div>
          </form>
        </PlatformModal>
      )}

      {membersFor && (
        <PlatformModal title={membersFor.name} description="Store access only. Operational resources stay with the tenant." onClose={() => setMembersFor(null)}>
          {members.isLoading && <p className="muted">Loading members…</p>}
          {(members.data ?? []).map((member) => (
            <div className="platform-member-row" key={member.id}>
              <span>
                <strong>{member.user?.name ?? "Unknown user"}</strong>
                <small>{member.user?.email ?? "—"}</small>
              </span>
              <b>{member.role}</b>
            </div>
          ))}
          {!members.isLoading && (members.data ?? []).length === 0 && (
            <EmptyState title="No members" hint="This store has no staff yet." />
          )}
        </PlatformModal>
      )}
    </PlatformPage>
  );
}
