import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
};

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
  const queryClient = useQueryClient();

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

  const stores = useQuery({
    queryKey: ["admin-stores"],
    queryFn: async () => (await api.get<{ data: SystemStore[] }>("/api/admin/stores", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
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
        <h1>Platform</h1>
        <p className="notice notice-warn">This area is limited to platform administrators.</p>
      </div>
    );
  }

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <div className="page">
      <header className="page-header">
        <h1>Platform</h1>
        <p className="muted">{stores.data?.length ?? 0} stores</p>
      </header>

      <section className="drawer-card">
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

      <h2 className="settings-subhead">Every store</h2>
      <table className="table">
        <thead>
          <tr><th>Store</th><th>Owner</th><th>Staff</th><th>Sales</th><th>Created</th></tr>
        </thead>
        <tbody>
          {(stores.data ?? []).map((s) => (
            <tr key={s.id}>
              <td>
                {s.name}
                <span className="muted"> · {s.currency}</span>
              </td>
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
              <td>{s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"}</td>
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
    </div>
  );
}
