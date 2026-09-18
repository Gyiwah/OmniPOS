import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Network, Wifi, WifiOff } from "lucide-react";

import { api } from "@/api/client";
import {
  EmptyState,
  PlatformDenied,
  PlatformPage,
  SearchField,
  StatusBadge,
  usePlatformAccess,
} from "./PlatformChrome";

type SyncMonitor = {
  summary: {
    stores_online: number;
    stores_total: number;
    devices_online: number;
    devices_total: number;
    pending_operations: number;
    failed_operations: number;
    open_conflicts: number;
  };
  stores: Array<{
    id: string;
    name: string;
    platform_status: string;
    devices: Array<{ id: string; label: string; platform: string; status: string; online: boolean; last_seen_at: string | null }>;
  }>;
  recent_failures: Array<{
    operation_id: string;
    status: string;
    store: string | null;
    device: string | null;
    entity: string;
    record_id: string;
    error: string | null;
    created_at: string | null;
  }>;
};

export function SynchronizationPage() {
  const isSuperAdmin = usePlatformAccess();
  const [query, setQuery] = useState("");

  const sync = useQuery({
    queryKey: ["admin-sync-monitor"],
    queryFn: () => api.get<SyncMonitor>("/api/admin/sync-monitor", undefined, { storeless: true }),
    enabled: isSuperAdmin,
    refetchInterval: 30000,
  });

  const stores = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (sync.data?.stores ?? []).filter((store) => store.name.toLowerCase().includes(needle));
  }, [sync.data, query]);

  if (!isSuperAdmin) return <PlatformDenied title="Sync" />;

  const summary = sync.data?.summary;

  return (
    <PlatformPage
      icon={Network}
      title="Synchronization"
      description="Queue health across the estate. This view refreshes every 30 seconds and never edits store data."
    >
      <section className="platform-sync-summary">
        <div><small>Stores online</small><strong>{summary?.stores_online ?? 0}/{summary?.stores_total ?? 0}</strong></div>
        <div><small>Devices online</small><strong>{summary?.devices_online ?? 0}/{summary?.devices_total ?? 0}</strong></div>
        <div><small>Pending</small><strong>{summary?.pending_operations ?? 0}</strong></div>
        <div><small>Failed</small><strong>{summary?.failed_operations ?? 0}</strong></div>
        <div><small>Conflicts</small><strong>{summary?.open_conflicts ?? 0}</strong></div>
      </section>

      <section className="platform-panel">
        <div className="platform-toolbar">
          <h2>Store connectivity</h2>
          <SearchField value={query} onChange={setQuery} placeholder="Filter stores" />
        </div>
        <div className="platform-sync-stores">
          {stores.map((store) => {
            const online = store.devices.filter((device) => device.online).length;
            return (
              <div className="platform-sync-store" key={store.id}>
                <div>
                  <strong>{store.name}</strong>
                  <small>{store.devices.length} device{store.devices.length === 1 ? "" : "s"}</small>
                </div>
                <span>
                  {online > 0 ? <Wifi size={16} /> : <WifiOff size={16} />}
                  {online} online
                </span>
                <StatusBadge status={store.platform_status} />
              </div>
            );
          })}
        </div>
        {sync.isLoading && <p className="muted">Loading synchronization health…</p>}
        {!sync.isLoading && stores.length === 0 && <EmptyState title="No stores to monitor" hint="Provision a store to see connectivity here." />}
      </section>

      <section className="platform-panel">
        <div className="platform-section-heading">
          <div>
            <h2>Recent failures</h2>
            <p>Failed and conflicted operations from the last batch.</p>
          </div>
        </div>
        {(sync.data?.recent_failures.length ?? 0) === 0 ? (
          <EmptyState title="No recent failures" hint="Queues are clear." />
        ) : (
          <div className="platform-failure-list">
            {sync.data?.recent_failures.slice(0, 20).map((failure) => (
              <div className="platform-failure-row" key={failure.operation_id}>
                <span>
                  <strong>{failure.status} · {failure.entity}</strong>
                  <small>{failure.store ?? "Unknown store"} · {failure.device ?? "Unknown device"} · {failure.created_at ? new Date(failure.created_at).toLocaleString() : ""}</small>
                </span>
                <code>{failure.error ?? "No error detail"}</code>
              </div>
            ))}
          </div>
        )}
      </section>
    </PlatformPage>
  );
}
