import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";

import { api } from "@/api/client";
import {
  EmptyState,
  PlatformDenied,
  PlatformPage,
  SearchField,
  usePlatformAccess,
} from "./PlatformChrome";

type AuditEntry = {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  store_id: string | null;
  user: { name: string; email: string } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string | null;
};

export function AuditLogsPage() {
  const isSuperAdmin = usePlatformAccess();
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");

  const logs = useQuery({
    queryKey: ["admin-audit-logs-page", action],
    queryFn: async () => (await api.get<{ data: AuditEntry[] }>("/api/admin/audit-logs", { action: action || undefined, limit: "80" }, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const rows = (logs.data ?? []).filter((entry) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${entry.action} ${entry.user?.name ?? ""} ${entry.user?.email ?? ""} ${entry.entity_type ?? ""}`.toLowerCase().includes(needle);
  });

  if (!isSuperAdmin) return <PlatformDenied title="Audit" />;

  return (
    <PlatformPage
      icon={ScrollText}
      title="Audit log"
      description="Read-only record of platform and store-management actions. Nothing here can be edited."
    >
      <section className="platform-panel">
        <div className="platform-toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Search actions or people" />
          <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter audit actions">
            <option value="">All actions</option>
            <option value="platform.store">Stores</option>
            <option value="platform.branch">Branches</option>
            <option value="platform.device">Devices</option>
            <option value="platform.plan">Plans</option>
            <option value="platform.subscription">Subscriptions</option>
            <option value="platform.user">People</option>
            <option value="staff.">Staff</option>
          </select>
          <span className="platform-panel-count">{rows.length}</span>
        </div>
        <div className="platform-audit-list">
          {rows.map((entry) => (
            <article className="platform-audit-row" key={entry.id}>
              <span className="platform-audit-time">{entry.created_at ? new Date(entry.created_at).toLocaleString() : "—"}</span>
              <span>
                <strong>{entry.action}</strong>
                <small>{entry.user?.name ?? "System"} · {entry.entity_type ?? "platform"}{entry.ip_address ? ` · ${entry.ip_address}` : ""}</small>
              </span>
              <code>{entry.after ? JSON.stringify(entry.after) : entry.user?.email ?? "—"}</code>
            </article>
          ))}
        </div>
        {logs.isLoading && <p className="muted">Loading audit activity…</p>}
        {!logs.isLoading && rows.length === 0 && <EmptyState title="No audit activity" hint="Actions taken in this console will appear here." />}
      </section>
    </PlatformPage>
  );
}
