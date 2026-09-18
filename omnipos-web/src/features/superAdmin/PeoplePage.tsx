import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";
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

type PlatformPerson = {
  id: string;
  name: string;
  email: string;
  is_super_admin: boolean;
  active: boolean;
  member_stores: Array<{ store_id: string; store_name: string | null; role: string }>;
};

type StoreOption = { id: string; name: string };

const ROLES = ["admin", "manager", "cashier"];
const emptyForm = {
  name: "",
  email: "",
  password: "",
  is_super_admin: false,
  store_id: "",
  role: "cashier",
};

export function PeoplePage() {
  const isSuperAdmin = usePlatformAccess();
  const currentUserId = useSession((s) => s.user?.id);
  const queryClient = useQueryClient();
  const { toast, setToast } = useToast();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlatformPerson | null>(null);
  const [form, setForm] = useState(emptyForm);

  const people = useQuery({
    queryKey: ["admin-people"],
    queryFn: async () => (await api.get<{ data: PlatformPerson[] }>("/api/admin/people", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const stores = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => (await api.get<{ data: StoreOption[] }>("/api/admin/stores", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin && open,
  });

  const savePerson = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password || undefined,
        is_super_admin: form.is_super_admin,
        store_id: form.store_id || undefined,
        role: form.store_id ? form.role : undefined,
      };
      if (editing) return api.patch(`/api/admin/people/${editing.id}`, payload, { storeless: true });
      return api.post("/api/admin/people", payload, { storeless: true });
    },
    onSuccess: () => {
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      setToast(editing ? "Person updated." : "Person added.");
      void queryClient.invalidateQueries({ queryKey: ["admin-people"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not save the person."),
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, storeId, role }: { userId: string; storeId: string; role: string }) =>
      api.patch(`/api/admin/people/${userId}/stores/${storeId}`, { role }, { storeless: true }),
    onSuccess: () => {
      setToast("Store role updated.");
      void queryClient.invalidateQueries({ queryKey: ["admin-people"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not update the role."),
  });

  const deletePerson = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/people/${id}`, { storeless: true }),
    onSuccess: () => {
      setOpen(false);
      setEditing(null);
      setToast("Person deleted.");
      void queryClient.invalidateQueries({ queryKey: ["admin-people"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not delete the person."),
  });

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (people.data ?? []).filter((person) => {
      const matchesQuery = `${person.name} ${person.email}`.toLowerCase().includes(needle);
      const matchesScope =
        scope === "all"
        || (scope === "admins" && person.is_super_admin)
        || (scope === "store" && !person.is_super_admin);
      return matchesQuery && matchesScope;
    });
  }, [people.data, query, scope]);

  const liveEditing = (people.data ?? []).find((person) => person.id === editing?.id) ?? editing;

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (person: PlatformPerson) => {
    setEditing(person);
    setForm({
      name: person.name,
      email: person.email,
      password: "",
      is_super_admin: person.is_super_admin,
      store_id: "",
      role: "cashier",
    });
    setOpen(true);
  };

  if (!isSuperAdmin) return <PlatformDenied title="People" />;

  return (
    <PlatformPage
      icon={Users}
      title="People"
      description="Add operators, edit their details, and remove accounts that should no longer sign in."
      actions={
        <button type="button" className="pay-button" onClick={openCreate}>
          <Plus size={16} /> Add person
        </button>
      }
    >
      <PlatformToast message={toast} />
      <section className="platform-panel">
        <div className="platform-toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Search name or email" />
          <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Filter access">
            <option value="all">Everyone</option>
            <option value="admins">Platform admins</option>
            <option value="store">Store users</option>
          </select>
          <span className="platform-panel-count">{rows.length}</span>
        </div>
        <table className="table">
          <thead>
            <tr><th>Person</th><th>Status</th><th>Access</th><th>Stores</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((person) => (
              <tr key={person.id}>
                <td>
                  <strong>{person.name}</strong>
                  <div className="muted">{person.email}</div>
                </td>
                <td><StatusBadge status={person.active ? "active" : "inactive"} /></td>
                <td>{person.is_super_admin ? "Platform admin" : "Store user"}</td>
                <td>{person.member_stores.length === 0 ? "—" : person.member_stores.map((store) => store.store_name ?? "Unknown").join(", ")}</td>
                <td className="platform-row-actions">
                  <button type="button" className="icon-button" onClick={() => openEdit(person)}>Edit</button>
                  <button
                    type="button"
                    className="icon-button danger-button"
                    disabled={person.id === currentUserId}
                    onClick={() => {
                      if (person.id === currentUserId) return;
                      if (window.confirm(`Delete ${person.name}? They will no longer be able to sign in.`)) {
                        deletePerson.mutate(person.id);
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {people.isLoading && <p className="muted">Loading people…</p>}
        {!people.isLoading && rows.length === 0 && <EmptyState title="No people match" hint="Add a person or clear the filters." />}
      </section>

      {open && (
        <PlatformModal
          title={editing ? `Edit ${liveEditing?.name ?? "person"}` : "Add person"}
          description={editing ? "Update identity, password, platform access, and store membership." : "Create a login and optionally attach it to a store."}
          onClose={() => { setOpen(false); setEditing(null); }}
        >
          <form className="platform-form" onSubmit={(e) => { e.preventDefault(); savePerson.mutate(); }}>
            <Field id="person-name" label="Name">
              <input id="person-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field id="person-email" label="Email">
              <input id="person-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Field>
            <Field id="person-password" label={editing ? "New password (optional)" : "Password"}>
              <input
                id="person-password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required={!editing}
                minLength={editing && !form.password ? undefined : 8}
              />
            </Field>
            <label className="checkbox platform-admin-toggle">
              <input
                type="checkbox"
                checked={form.is_super_admin}
                onChange={(e) => setForm({ ...form, is_super_admin: e.target.checked })}
              />
              Platform administrator
            </label>
            <div className="platform-form-grid">
              <Field id="person-store" label={editing ? "Add to store" : "Store (optional)"}>
                <select id="person-store" value={form.store_id} onChange={(e) => setForm({ ...form, store_id: e.target.value })}>
                  <option value="">None</option>
                  {(stores.data ?? []).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </Field>
              <Field id="person-role" label="Role">
                <select id="person-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} disabled={!form.store_id}>
                  {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </Field>
            </div>

            {liveEditing && liveEditing.member_stores.length > 0 && (
              <>
                <h3 className="platform-subheading">Store memberships</h3>
                {liveEditing.member_stores.map((store) => (
                  <div className="platform-member-row" key={store.store_id}>
                    <span>
                      <strong>{store.store_name ?? "Unknown store"}</strong>
                      <small>Current role: {store.role}</small>
                    </span>
                    <select
                      value={store.role}
                      onChange={(e) => changeRole.mutate({ userId: liveEditing.id, storeId: store.store_id, role: e.target.value })}
                      aria-label={`Role at ${store.store_name ?? "store"}`}
                    >
                      {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </div>
                ))}
              </>
            )}

            <div className="platform-modal-actions">
              {editing && editing.id !== currentUserId && (
                <button
                  type="button"
                  className="icon-button danger-button"
                  onClick={() => {
                    if (window.confirm(`Delete ${editing.name}? They will no longer be able to sign in.`)) {
                      deletePerson.mutate(editing.id);
                    }
                  }}
                >
                  Delete
                </button>
              )}
              <button type="button" className="secondary-button" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</button>
              <button type="submit" className="pay-button" disabled={savePerson.isPending}>
                {editing ? "Save changes" : "Add person"}
              </button>
            </div>
          </form>
        </PlatformModal>
      )}
    </PlatformPage>
  );
}
