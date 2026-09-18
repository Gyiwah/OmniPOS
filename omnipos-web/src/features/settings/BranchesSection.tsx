import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Plus } from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";

type Branch = {
  id: string;
  name: string;
  platform_status: "active" | "suspended" | "inactive";
  members_count: number;
  orders_count: number;
};

const emptyForm = { name: "", platform_status: "active" as Branch["platform_status"] };

export function BranchesSection() {
  const can = useSession((s) => s.can);
  const storeId = useSession((s) => s.storeId);
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const isAdmin = can(["admin"]);

  const branches = useQuery({
    queryKey: ["store-branches", storeId],
    queryFn: async () => (await api.get<{ data: Branch[] }>("/api/store-branches")).data ?? [],
    enabled: Boolean(storeId) && isAdmin,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["store-branches"] });
  const save = useMutation({
    mutationFn: () => {
      const payload = { name: form.name.trim(), platform_status: form.platform_status };
      return editingId
        ? api.patch(`/api/store-branches/${editingId}`, payload)
        : api.post("/api/store-branches", payload);
    },
    onSuccess: () => {
      setOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      setNotice(editingId ? "Branch updated." : "Branch added.");
      refresh();
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : "Could not save the branch."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/store-branches/${id}`),
    onSuccess: () => {
      setNotice("Branch deleted.");
      refresh();
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : "Could not delete the branch."),
  });

  if (!isAdmin) return null;

  return (
    <section className="drawer-card">
      <div className="section-heading-row">
        <h2><GitBranch size={18} aria-hidden="true" /> Branches</h2>
        <button type="button" className="secondary-button" onClick={() => { setForm(emptyForm); setEditingId(null); setOpen(true); }}>
          <Plus size={15} aria-hidden="true" /> Add branch
        </button>
      </div>
      {notice && <p className="notice notice-ok" role="status">{notice}</p>}
      {open && (
        <form className="drawer-movement" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Branch name"
            aria-label="Branch name"
            required
          />
          <select
            value={form.platform_status}
            onChange={(event) => setForm({ ...form, platform_status: event.target.value as Branch["platform_status"] })}
            aria-label="Branch status"
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="inactive">Inactive</option>
          </select>
          <button type="submit" className="secondary-button" disabled={save.isPending}>
            {save.isPending ? "Saving…" : editingId ? "Save" : "Add"}
          </button>
          <button type="button" className="icon-button" onClick={() => setOpen(false)}>Cancel</button>
        </form>
      )}
      <table className="table">
        <thead><tr><th>Branch</th><th>Status</th><th>Staff</th><th>Orders</th><th /></tr></thead>
        <tbody>
          {(branches.data ?? []).map((branch) => (
            <tr key={branch.id}>
              <td>{branch.name}</td>
              <td>{branch.platform_status}</td>
              <td>{branch.members_count}</td>
              <td>{branch.orders_count}</td>
              <td className="row-actions">
                <button type="button" className="link" onClick={() => { setEditingId(branch.id); setForm({ name: branch.name, platform_status: branch.platform_status }); setOpen(true); }}>Edit</button>
                <button type="button" className="link danger" onClick={() => { if (window.confirm(`Delete ${branch.name}?`)) remove.mutate(branch.id); }}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {branches.isLoading && <p className="muted">Loading branches…</p>}
      {!branches.isLoading && (branches.data ?? []).length === 0 && <p className="muted">No branches yet.</p>}
    </section>
  );
}
