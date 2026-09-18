import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Users } from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";

type PlatformPerson = {
  id: string;
  name: string;
  email: string;
  is_super_admin: boolean;
  active: boolean;
  member_stores: Array<{ store_id: string; store_name: string | null; role: string }>;
};

export function PeoplePage() {
  const isSuperAdmin = useSession((s) => s.user?.is_super_admin ?? false);

  const people = useQuery({
    queryKey: ["admin-people"],
    queryFn: async () => (await api.get<{ data: PlatformPerson[] }>("/api/admin/people", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  if (!isSuperAdmin) {
    return (
      <div className="page">
        <h1><ShieldCheck size={20} /> People</h1>
        <p className="notice notice-warn">This area is limited to platform administrators.</p>
      </div>
    );
  }

  return (
    <div className="page platform-page">
      <header className="page-header">
        <div>
          <h1><Users size={20} /> People</h1>
          <p className="muted">Platform-wide staff visibility, memberships, and privilege status without exposing store operations.</p>
        </div>
        <span className="platform-scope-badge"><ShieldCheck size={14} /> Platform only</span>
      </header>

      <section className="platform-panel">
        <div className="platform-section-heading">
          <div>
            <h2>All people</h2>
            <p>View who belongs to which stores and whether they hold platform-admin access.</p>
          </div>
          <span className="platform-panel-count">{people.data?.length ?? 0}</span>
        </div>

        <table className="table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Status</th><th>Access</th><th>Stores</th></tr>
          </thead>
          <tbody>
            {(people.data ?? []).map((person) => (
              <tr key={person.id}>
                <td>{person.name}</td>
                <td>{person.email}</td>
                <td><span className={`platform-status ${person.active ? "platform-status-active" : "platform-status-inactive"}`}>{person.active ? "Active" : "Inactive"}</span></td>
                <td>{person.is_super_admin ? "Platform admin" : "Store user"}</td>
                <td>{person.member_stores.length > 0 ? person.member_stores.map((store) => `${store.store_name ?? "Unknown"} (${store.role})`).join(", ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {people.isLoading && <p className="muted">Loading people…</p>}
      </section>
    </div>
  );
}
