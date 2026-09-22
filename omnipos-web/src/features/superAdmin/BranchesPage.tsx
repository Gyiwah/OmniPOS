import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Plus } from "lucide-react";

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

type StoreOption = {
  id: string;
  name: string;
  parent_store_id?: string | null;
  owner_user_id?: string | null;
  owner?: { id: string; name: string; email: string } | null;
};

const emptyForm = {
  name: "",
  parent_store_id: "",
  currency: "GHS",
  timezone: "Africa/Accra",
  platform_status: "active" as BranchRecord["platform_status"],
};

export function BranchesPage() {
  const isSuperAdmin = usePlatformAccess();
  const queryClient = useQueryClient();
  const { toast, setToast } = useToast();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const branches = useQuery({
    queryKey: ["admin-branches"],
    queryFn: async () => (await api.get<{ data: BranchRecord[] }>("/api/admin/branches", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const parentStores = useQuery({
    queryKey: ["admin-store-options"],
    queryFn: async () => {
      const response = await api.get<{ data: StoreOption[] }>("/api/admin/stores", undefined, { storeless: true });
      return (response.data ?? []).filter((store) => !store.parent_store_id);
    },
    enabled: isSuperAdmin,
  });

  const saveBranch = useMutation({
    mutationFn: () => {
      const selectedParent = (parentStores.data ?? []).find((s) => s.id === form.parent_store_id);
      const ownerUserId = selectedParent?.owner_user_id || selectedParent?.owner?.id;

      const payload = {
        name: form.name.trim(),
        parent_store_id: form.parent_store_id,
        owner_user_id: ownerUserId,
        currency: form.currency || "GHS",
        timezone: form.timezone || "Africa/Accra",
        platform_status: form.platform_status,
      };
      if (editingId) return api.patch(`/api/admin/branches/${editingId}`, payload, { storeless: true });
      return api.post("/api/admin/branches", payload, { storeless: true });
    },
    onSuccess: () => {
      setForm(emptyForm);
      setEditingId(null);
      setOpen(false);
      setToast(editingId ? "Branch updated." : "Branch created.");
      void queryClient.invalidateQueries({ queryKey: ["admin-branches"] });
    },
    onError: (cause) => setToast(cause instanceof Error ? cause.message : "Could not save the branch."),
  });

  const deleteBranch = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/branches/${id}`, { storeless: true }),
    onSuccess: () => {
      setToast("Branch deleted.");
      void queryClient.invalidateQueries({ queryKey: ["admin-branches"] });
    },
    onError: (cause) => setToast(cause instanceof Error ? cause.message : "Could not delete the branch."),
  });

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (branches.data ?? []).filter((branch) =>
      `${branch.name} ${branch.parent_store?.name ?? ""} ${branch.owner?.name ?? ""}`.toLowerCase().includes(needle),
    );
  }, [branches.data, query]);

  if (!isSuperAdmin) return <PlatformDenied title="Branches" />;

  return (
    <PlatformPage
      icon={Boxes}
      title="Branches"
      description="Branches inherit currency and timezone from how you create them, but they always sit under a parent store."
      actions={
        <button type="button" className="pay-button" onClick={() => { setEditingId(null); setForm(emptyForm); setOpen(true); }}>
          <Plus size={16} /> New branch
        </button>
      }
    >
      <PlatformToast message={toast} />
      <section className="platform-panel">
        <div className="platform-toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Search branches" />
          <span className="platform-panel-count">{rows.length}</span>
        </div>
        <table className="table">
          <thead>
            <tr><th>Branch</th><th>Parent store</th><th>Status</th><th>Owner</th><th>Staff</th><th>Orders</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((branch) => (
              <tr key={branch.id}>
                <td>{branch.name}</td>
                <td>{branch.parent_store?.name ?? "—"}</td>
                <td><StatusBadge status={branch.platform_status} /></td>
                <td>
                  {branch.owner?.name ?? "—"}
                  {branch.owner && <div className="muted">{branch.owner.email}</div>}
                </td>
                <td>{branch.members_count}</td>
                <td>{branch.orders_count}</td>
                <td className="platform-row-actions">
                  <button type="button" className="icon-button" onClick={() => {
                    setEditingId(branch.id);
                    setForm({
                      name: branch.name,
                      parent_store_id: branch.parent_store?.id ?? "",
                      currency: "GHS",
                      timezone: "Africa/Accra",
                      platform_status: branch.platform_status,
                    });
                    setOpen(true);
                  }}>Edit</button>
                  <button
                    type="button"
                    className="icon-button danger-button"
                    onClick={() => {
                      if (window.confirm(`Delete ${branch.name}?`)) deleteBranch.mutate(branch.id);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {branches.isLoading && <p className="muted">Loading branches…</p>}
        {!branches.isLoading && rows.length === 0 && <EmptyState title="No branches" hint="Create a branch under an existing store." />}
      </section>

      {open && (
        <PlatformModal title={editingId ? "Edit branch" : "Create branch"} onClose={() => setOpen(false)}>
          <form className="platform-form" onSubmit={(e) => { e.preventDefault(); saveBranch.mutate(); }}>
            <Field id="br-name" label="Branch name">
              <input id="br-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field id="br-parent" label="Parent store">
              <select id="br-parent" value={form.parent_store_id} onChange={(e) => setForm({ ...form, parent_store_id: e.target.value })} required>
                <option value="">Select parent store</option>
                {(parentStores.data ?? []).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </Field>
            <div className="platform-form-grid">
              <Field id="br-currency" label="Currency">
                <input id="br-currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
              </Field>
              <Field id="br-tz" label="Timezone">
                <input id="br-tz" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
              </Field>
            </div>
            <Field id="br-status" label="Status">
              <select id="br-status" value={form.platform_status} onChange={(e) => setForm({ ...form, platform_status: e.target.value as BranchRecord["platform_status"] })}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
            <div className="platform-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="pay-button" disabled={saveBranch.isPending}>
                {editingId ? "Save changes" : "Create branch"}
              </button>
            </div>
          </form>
        </PlatformModal>
      )}
    </PlatformPage>
  );
}
