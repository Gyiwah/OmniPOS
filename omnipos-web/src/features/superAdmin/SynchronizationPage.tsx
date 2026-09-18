import { useQuery } from "@tanstack/react-query";
import { Network, ShieldCheck } from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";

type SyncData = {
  summary: {
    stores_online: number;
    stores_total: number;
    devices_online: number;
    devices_total: number;
    pending_operations: number;
    failed_operations: number;
    open_conflicts: number;
  };
  recent_failures: Array<{ operation_id: string; status: string; store: string | null; device: string | null; entity: string; error: string | null }>;
};

export function SynchronizationPage() {
  const isSuperAdmin = useSession((s) => s.user?.is_super_admin ?? false);

  const sync = useQuery({
    queryKey: ["admin-sync-page"],
    queryFn: () => api.get<SyncData>("/api/admin/sync-monitor", undefined, { storeless: true }),
    enabled: isSuperAdmin,
    refetchInterval: 30000,
  });

  if (!isSuperAdmin) {
    return (<div className="page"><h1><ShieldCheck size={20} /> Synchronization</h1><p className="notice notice-warn">This area is limited to platform administrators.</p></div>);
  }

  return (
    <div className="page platform-page">
      <header className="page-header">
        <div>
          <h1><Network size={20} /> Synchronization</h1>
          <p className="muted">Platform-wide sync operations, pending queues, and recent failures.</p>
        </div>
        <span className="platform-scope-badge"><ShieldCheck size={14} /> Platform only</span>
      </header>

      <section className="platform-panel">
        <div className="platform-section-heading">
          <div><h2>Health overview</h2><p>Store and device connectivity, queued work, and open conflicts.</p></div>
          <span className="platform-panel-count">{sync.data?.summary.stores_online ?? 0}</span>
        </div>

        <div className="platform-sync-summary">
          <div><small>Stores online</small><strong>{sync.data?.summary.stores_online ?? 0}/{sync.data?.summary.stores_total ?? 0}</strong></div>
          <div><small>Devices online</small><strong>{sync.data?.summary.devices_online ?? 0}/{sync.data?.summary.devices_total ?? 0}</strong></div>
          <div><small>Pending</small><strong>{sync.data?.summary.pending_operations ?? 0}</strong></div>
          <div><small>Failed</small><strong>{sync.data?.summary.failed_operations ?? 0}</strong></div>
          <div><small>Conflicts</small><strong>{sync.data?.summary.open_conflicts ?? 0}</strong></div>
        </div>

        <h3 className="platform-subheading">Recent failures</h3>
        {(sync.data?.recent_failures ?? []).length === 0 ? <p className="muted">No recent sync failures.</p> : <div className="platform-failure-list">{(sync.data?.recent_failures ?? []).slice(0, 8).map((failure) => <div className="platform-failure-row" key={failure.operation_id}><span><strong>{failure.status} · {failure.entity}</strong><small>{failure.store ?? "Unknown store"} · {failure.device ?? "Unknown device"}</small></span><code>{failure.error ?? "No error detail"}</code></div>)}</div>}
      </section>
    </div>
  );
}
