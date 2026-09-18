import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphone } from "lucide-react";

import { api } from "@/api/client";
import {
  EmptyState,
  PlatformDenied,
  PlatformPage,
  PlatformToast,
  SearchField,
  StatusBadge,
  usePlatformAccess,
  useToast,
} from "./PlatformChrome";

type PlatformDevice = {
  id: string;
  platform: string;
  terminal_label: string | null;
  app_version: string | null;
  platform_status: string;
  last_seen_at: string | null;
  store: { name: string } | null;
  user: { name: string; email: string } | null;
};

export function DevicesPage() {
  const isSuperAdmin = usePlatformAccess();
  const queryClient = useQueryClient();
  const { toast, setToast } = useToast();
  const [query, setQuery] = useState("");

  const devices = useQuery({
    queryKey: ["admin-devices"],
    queryFn: async () => (await api.get<{ data: PlatformDevice[] }>("/api/admin/devices", undefined, { storeless: true })).data ?? [],
    enabled: isSuperAdmin,
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/api/admin/devices/${id}/status`, { status }, { storeless: true }),
    onSuccess: () => {
      setToast("Device status updated.");
      void queryClient.invalidateQueries({ queryKey: ["admin-devices"] });
    },
    onError: (e) => setToast(e instanceof Error ? e.message : "Could not update the device."),
  });

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (devices.data ?? []).filter((device) =>
      `${device.terminal_label ?? ""} ${device.platform} ${device.store?.name ?? ""} ${device.user?.email ?? ""}`.toLowerCase().includes(needle),
    );
  }, [devices.data, query]);

  if (!isSuperAdmin) return <PlatformDenied title="Devices" />;

  return (
    <PlatformPage
      icon={MonitorSmartphone}
      title="Devices"
      description="Registered terminals across every store. Revoke a device here when it should no longer sync."
    >
      <PlatformToast message={toast} />
      <section className="platform-panel">
        <div className="platform-toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Search devices, stores, or users" />
          <span className="platform-panel-count">{rows.length}</span>
        </div>
        <table className="table">
          <thead>
            <tr><th>Terminal</th><th>Store</th><th>Operator</th><th>Version</th><th>Last seen</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((device) => (
              <tr key={device.id}>
                <td>
                  <strong>{device.terminal_label ?? device.platform}</strong>
                  <div className="muted">{device.platform}</div>
                </td>
                <td>{device.store?.name ?? "Unassigned"}</td>
                <td>{device.user?.name ?? "—"}</td>
                <td>{device.app_version ?? "—"}</td>
                <td>{device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : "Never"}</td>
                <td className="platform-row-actions">
                  <StatusBadge status={device.platform_status} />
                  <select
                    value={device.platform_status}
                    onChange={(e) => changeStatus.mutate({ id: device.id, status: e.target.value })}
                    aria-label={`Change status for ${device.terminal_label ?? device.platform}`}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="revoked">Revoked</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {devices.isLoading && <p className="muted">Loading devices…</p>}
        {!devices.isLoading && rows.length === 0 && <EmptyState title="No devices registered" hint="Terminals appear here after they sign in and register." />}
      </section>
    </PlatformPage>
  );
}
