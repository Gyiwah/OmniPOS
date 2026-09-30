import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Code,
  Filter,
  Globe,
  Printer,
  RefreshCw,
  ScrollText,
  Search,
  Shield,
  User,
  X,
} from "lucide-react";

import { api } from "@/api/client";
import { printTableAsPdf } from "@/utils/printTable";
import {
  EmptyState,
  PlatformDenied,
  PlatformModal,
  PlatformPage,
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

const CATEGORIES = [
  { key: "", label: "All Events" },
  { key: "platform.store", label: "Stores" },
  { key: "platform.branch", label: "Branches" },
  { key: "platform.device", label: "Devices" },
  { key: "platform.plan", label: "Plans" },
  { key: "platform.subscription", label: "Subscriptions" },
  { key: "platform.user", label: "Users" },
  { key: "staff.", label: "Staff" },
];

export function AuditLogsPage() {
  const isSuperAdmin = usePlatformAccess();
  const [query, setQuery] = useState("");
  const [actionCategory, setActionCategory] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const [limit, setLimit] = useState("80");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const logs = useQuery({
    queryKey: ["admin-audit-logs-page", actionCategory, limit],
    queryFn: async () =>
      (
        await api.get<{ data: AuditEntry[] }>(
          "/api/admin/audit-logs",
          { action: actionCategory || undefined, limit },
          { storeless: true },
        )
      ).data ?? [],
    enabled: isSuperAdmin,
  });

  const allEntries = logs.data ?? [];

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return allEntries;
    return allEntries.filter((entry) => {
      const actorName = entry.user?.name ?? "";
      const actorEmail = entry.user?.email ?? "";
      const action = entry.action ?? "";
      const entityType = entry.entity_type ?? "";
      const entityId = entry.entity_id ?? "";
      const ip = entry.ip_address ?? "";
      const searchBlob = `${action} ${actorName} ${actorEmail} ${entityType} ${entityId} ${ip}`.toLowerCase();
      return searchBlob.includes(needle);
    });
  }, [allEntries, query]);

  // Derived statistics
  const uniqueActors = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.user?.email) set.add(r.user.email);
    }
    return set.size;
  }, [rows]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await logs.refetch();
    setIsRefreshing(false);
  };

  const handleExportPdf = () => {
    printTableAsPdf({
      title: "OmniPOS Platform Audit & Governance Trail",
      columns: ["Timestamp", "Action", "Operator / Actor", "Target Entity", "IP Address", "Modified Payload"],
      rows: rows.map((e) => [
        e.created_at ? new Date(e.created_at).toLocaleString() : "—",
        e.action,
        e.user ? `${e.user.name} (${e.user.email})` : "System Automated",
        e.entity_type ? `${e.entity_type} #${e.entity_id ?? ""}` : "Platform Global",
        e.ip_address ?? "Internal",
        e.after ? JSON.stringify(e.after).slice(0, 80) : "—",
      ]),
    });
  };

  const getActionBadgeClass = (action: string) => {
    if (action.includes("store")) return "audit-badge badge-store";
    if (action.includes("branch")) return "audit-badge badge-branch";
    if (action.includes("device")) return "audit-badge badge-device";
    if (action.includes("plan")) return "audit-badge badge-plan";
    if (action.includes("subscription")) return "audit-badge badge-sub";
    if (action.includes("user") || action.includes("staff") || action.includes("person"))
      return "audit-badge badge-user";
    return "audit-badge badge-default";
  };

  if (!isSuperAdmin) return <PlatformDenied title="Audit" />;

  return (
    <PlatformPage
      icon={ScrollText}
      title="Audit & Governance Trail"
      description="Immutable ledger of administrative actions, tenant provisioning, permissions, and security events."
      actions={
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            className="secondary-button"
            onClick={handleExportPdf}
            disabled={rows.length === 0}
            title="Export filtered audit logs as printable PDF"
          >
            <Printer size={15} aria-hidden="true" />
            <span>Export Log (PDF)</span>
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            title="Refresh audit log stream"
          >
            <RefreshCw size={15} className={isRefreshing ? "spin-icon" : ""} aria-hidden="true" />
            <span>{isRefreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      }
    >
      {/* Executive Quick Stats Cards */}
      <section className="platform-kpi-bento" style={{ marginBottom: "1rem" }}>
        <div className="platform-kpi-card">
          <div className="platform-kpi-header">
            <span className="platform-kpi-title">
              <ScrollText size={15} aria-hidden="true" /> Audit Events
            </span>
            <span className="platform-kpi-icon-wrap">
              <Shield size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="platform-kpi-value">{rows.length}</div>
          <div className="platform-kpi-footer">
            <span>Filtered records loaded</span>
            <span className="platform-kpi-badge badge-ok">Tamper-evident</span>
          </div>
        </div>

        <div className="platform-kpi-card">
          <div className="platform-kpi-header">
            <span className="platform-kpi-title">
              <User size={15} aria-hidden="true" /> Active Actors
            </span>
            <span className="platform-kpi-icon-wrap">
              <User size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="platform-kpi-value">{uniqueActors}</div>
          <div className="platform-kpi-footer">
            <span>Distinct administrators</span>
            <span className="platform-kpi-badge badge-info">Multi-operator</span>
          </div>
        </div>

        <div className="platform-kpi-card">
          <div className="platform-kpi-header">
            <span className="platform-kpi-title">
              <Filter size={15} aria-hidden="true" /> Domain Scope
            </span>
            <span className="platform-kpi-icon-wrap">
              <Globe size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="platform-kpi-value" style={{ fontSize: "1.1rem" }}>
            {actionCategory || "Global Platform"}
          </div>
          <div className="platform-kpi-footer">
            <span>Query limit: {limit} rows</span>
            <span className="platform-kpi-badge badge-info">Active Scope</span>
          </div>
        </div>
      </section>

      {/* Modern Filter & Search Toolbar */}
      <div className="platform-toolbar-pro">
        <div className="platform-toolbar-left">
          <label className="search-field platform-search" style={{ minWidth: "260px" }}>
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">Search actions, operators, or target entities</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search actions, operators, IP, entity…"
            />
            {query && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </label>

          {/* Quick Domain Filter Chips */}
          <div className="platform-chip-group">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                type="button"
                className={`platform-chip ${actionCategory === cat.key ? "active" : ""}`}
                onClick={() => setActionCategory(cat.key)}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="platform-toolbar-right">
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", color: "var(--muted)" }}>
            Fetch:
            <select
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              style={{
                padding: "0.25rem 0.5rem",
                fontSize: "0.75rem",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--line)",
                background: "var(--surface)",
                color: "var(--text-strong)",
              }}
              aria-label="Records limit"
            >
              <option value="50">50 rows</option>
              <option value="80">80 rows</option>
              <option value="100">100 rows</option>
            </select>
          </label>
          <span className="platform-panel-count" title="Number of matching audit events">
            {rows.length}
          </span>
        </div>
      </div>

      {/* Main Audit Ledger Table */}
      <div className="platform-table-wrap">
        <table className="platform-table-pro">
          <thead>
            <tr>
              <th style={{ width: "160px" }}>Timestamp</th>
              <th>Action & Domain</th>
              <th>Actor & Identity</th>
              <th>Target Entity</th>
              <th>IP Origin</th>
              <th style={{ textAlign: "right" }}>Payload & Diff</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => {
              const dateStr = entry.created_at ? new Date(entry.created_at) : null;
              const hasDiff = Boolean(entry.before || entry.after);

              return (
                <tr key={entry.id}>
                  {/* Timestamp Column */}
                  <td style={{ whiteSpace: "nowrap" }}>
                    <div style={{ display: "grid", gap: "0.1rem" }}>
                      <strong style={{ fontSize: "0.78rem" }}>
                        {dateStr ? dateStr.toLocaleDateString() : "—"}
                      </strong>
                      <small style={{ color: "var(--muted)", fontSize: "0.7rem" }}>
                        {dateStr ? dateStr.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                      </small>
                    </div>
                  </td>

                  {/* Action & Domain Column */}
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", alignItems: "flex-start" }}>
                      <span className={getActionBadgeClass(entry.action)}>
                        {entry.action}
                      </span>
                    </div>
                  </td>

                  {/* Actor Column */}
                  <td>
                    <div style={{ display: "grid", gap: "0.1rem" }}>
                      <strong style={{ fontSize: "0.82rem" }}>
                        {entry.user?.name ?? "Automated System"}
                      </strong>
                      <small style={{ color: "var(--muted)", fontSize: "0.72rem" }}>
                        {entry.user?.email ?? "system.internal"}
                      </small>
                    </div>
                  </td>

                  {/* Target Entity Column */}
                  <td>
                    {entry.entity_type ? (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                        <span
                          style={{
                            padding: "0.15rem 0.45rem",
                            borderRadius: "var(--radius-sm)",
                            background: "var(--panel-2)",
                            border: "1px solid var(--line)",
                            fontSize: "0.72rem",
                            fontWeight: 600,
                            textTransform: "capitalize",
                          }}
                        >
                          {entry.entity_type}
                        </span>
                        {entry.entity_id && (
                          <small
                            style={{
                              color: "var(--muted)",
                              fontFamily: "ui-monospace, monospace",
                              fontSize: "0.7rem",
                              maxWidth: "100px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={entry.entity_id}
                          >
                            #{entry.entity_id.slice(0, 8)}
                          </small>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>Platform Global</span>
                    )}
                  </td>

                  {/* IP Column */}
                  <td>
                    <span
                      style={{
                        fontSize: "0.72rem",
                        fontFamily: "ui-monospace, monospace",
                        color: "var(--muted)",
                      }}
                    >
                      {entry.ip_address || "127.0.0.1"}
                    </span>
                  </td>

                  {/* Action & Inspect Column */}
                  <td style={{ textAlign: "right" }}>
                    {hasDiff ? (
                      <button
                        type="button"
                        className="audit-inspect-btn"
                        onClick={() => setSelectedEntry(entry)}
                        title="Inspect full state change diff"
                      >
                        <Code size={13} aria-hidden="true" />
                        <span>Inspect Payload</span>
                      </button>
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: "0.72rem" }}>No state changes</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {logs.isLoading && (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
            Loading audit governance activity stream…
          </div>
        )}

        {!logs.isLoading && rows.length === 0 && (
          <EmptyState
            title="No audit activity matches criteria"
            hint="Actions executed across the platform console or tenant stores will record here."
          />
        )}
      </div>

      {/* Interactive Payload & Diff Inspector Modal */}
      {selectedEntry && (
        <PlatformModal
          title={`Audit Event #${selectedEntry.id} Details`}
          description={`${selectedEntry.action} recorded on ${selectedEntry.created_at ? new Date(selectedEntry.created_at).toLocaleString() : "—"}`}
          onClose={() => setSelectedEntry(null)}
          wide
        >
          <div style={{ display: "grid", gap: "1rem" }}>
            {/* Meta summary card */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: "0.75rem",
                padding: "0.85rem",
                background: "var(--panel-2)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--line)",
              }}
            >
              <div>
                <small style={{ color: "var(--muted)", fontSize: "0.7rem", textTransform: "uppercase" }}>Actor</small>
                <div style={{ fontWeight: 700, fontSize: "0.82rem" }}>{selectedEntry.user?.name ?? "System"}</div>
                <small style={{ color: "var(--muted)", fontSize: "0.72rem" }}>{selectedEntry.user?.email ?? "—"}</small>
              </div>
              <div>
                <small style={{ color: "var(--muted)", fontSize: "0.7rem", textTransform: "uppercase" }}>Target</small>
                <div style={{ fontWeight: 700, fontSize: "0.82rem", textTransform: "capitalize" }}>
                  {selectedEntry.entity_type ?? "Platform Core"}
                </div>
                <small style={{ color: "var(--muted)", fontFamily: "monospace", fontSize: "0.7rem" }}>
                  {selectedEntry.entity_id ?? "N/A"}
                </small>
              </div>
              <div>
                <small style={{ color: "var(--muted)", fontSize: "0.7rem", textTransform: "uppercase" }}>IP Address</small>
                <div style={{ fontWeight: 700, fontSize: "0.82rem", fontFamily: "monospace" }}>
                  {selectedEntry.ip_address ?? "Internal"}
                </div>
              </div>
              <div>
                <small style={{ color: "var(--muted)", fontSize: "0.7rem", textTransform: "uppercase" }}>Store ID</small>
                <div style={{ fontWeight: 600, fontSize: "0.78rem", fontFamily: "monospace" }}>
                  {selectedEntry.store_id ? selectedEntry.store_id.slice(0, 13) + "…" : "Global"}
                </div>
              </div>
            </div>

            {/* Before vs After Diff Container */}
            <div className="audit-diff-container">
              <div className="audit-diff-box">
                <div className="audit-diff-title">State Before Action</div>
                <pre className="audit-diff-content">
                  {selectedEntry.before
                    ? JSON.stringify(selectedEntry.before, null, 2)
                    : "// No previous state recorded (creation event or null)"}
                </pre>
              </div>

              <div className="audit-diff-box">
                <div className="audit-diff-title" style={{ color: "var(--ok)" }}>
                  State After Action
                </div>
                <pre className="audit-diff-content">
                  {selectedEntry.after
                    ? JSON.stringify(selectedEntry.after, null, 2)
                    : "// No after state recorded"}
                </pre>
              </div>
            </div>

            <div className="platform-modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setSelectedEntry(null)}
              >
                Close Inspector
              </button>
            </div>
          </div>
        </PlatformModal>
      )}
    </PlatformPage>
  );
}
