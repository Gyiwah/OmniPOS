import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, ScrollText } from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";

type AuditEntry = {
  id: number;
  action: string;
  user: { name: string; email: string } | null;
  store_id: string | null;
  created_at: string | null;
};

export function AuditLogsPage() {
  const isSuperAdmin = useSession((s) => s.user?.is_super_admin ?? false);

  const logs = useQuery({
    queryKey: ["admin-audit-logs-page"],
    queryFn: async () => (await api.get<{ data: AuditEntry[] }>("/api/admin/audit-logs", { limit: "30" }, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  if (!isSuperAdmin) {
    return (<div className="page"><h1><ShieldCheck size={20} /> Audit Logs</h1><p className="notice notice-warn">This area is limited to platform administrators.</p></div>);
  }

  return (
    <div className="page platform-page">
      <header className="page-header">
        <div>
          <h1><ScrollText size={20} /> Audit Logs</h1>
          <p className="muted">Immutable platform and store actions recorded across the environment.</p>
        </div>
        <span className="platform-scope-badge"><ShieldCheck size={14} /> Platform only</span>
      </header>

      <section className="platform-panel">
        <div className="platform-section-heading"><div><h2>Recent activity</h2><p>Read-only trail of who changed what and when.</p></div><span className="platform-panel-count">{logs.data?.length ?? 0}</span></div>

        <div className="platform-audit-list">
          {(logs.data ?? []).map((entry) => (
            <article className="platform-audit-row" key={entry.id}>
              <span className="platform-audit-time">{entry.created_at ? new Date(entry.created_at).toLocaleString() : "—"}</span>
              <span><strong>{entry.action}</strong><small>{entry.user?.name ?? "System"} · {entry.store_id ? `Store ${entry.store_id.slice(0, 8)}` : "Platform"}</small></span>
              <code>{entry.user?.email ?? "—"}</code>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
