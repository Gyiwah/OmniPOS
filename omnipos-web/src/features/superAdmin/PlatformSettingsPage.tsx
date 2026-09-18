import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Settings, ShieldCheck } from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";

type SystemSetting = {
  key: string;
  value: Record<string, unknown> | null;
  description: string | null;
};

type Resources = {
  categories: Array<{ id: string; name: string; slug: string; status: string; position: number }>;
  settings: SystemSetting[];
};

const DEFAULT_KEYS = [
  "platform.maintenance",
  "platform.default_currency",
  "platform.default_timezone",
  "platform.default_language",
  "platform.notifications.email",
];

export function PlatformSettingsPage() {
  const isSuperAdmin = useSession((s) => s.user?.is_super_admin ?? false);
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState(DEFAULT_KEYS[0]);
  const [jsonValue, setJsonValue] = useState('{"enabled":false}');
  const [description, setDescription] = useState("Platform default behavior");
  const [toast, setToast] = useState<string | null>(null);

  const resources = useQuery({
    queryKey: ["admin-platform-settings"],
    queryFn: () => api.get<Resources>("/api/admin/system-resources", undefined, { storeless: true }),
    enabled: isSuperAdmin,
  });

  const settingsMap = useMemo(() => new Map((resources.data?.settings ?? []).map((item) => [item.key, item])), [resources.data]);

  const selectedSetting = settingsMap.get(selectedKey) ?? {
    key: selectedKey,
    value: { enabled: false },
    description: "Platform global setting",
  };

  const save = useMutation({
    mutationFn: () => api.patch(`/api/admin/system-resources/settings/${encodeURIComponent(selectedKey)}`, {
      value: JSON.parse(jsonValue),
      description: description || null,
    }, { storeless: true }),
    onSuccess: () => {
      setToast("Platform setting saved.");
      void queryClient.invalidateQueries({ queryKey: ["admin-platform-settings"] });
    },
    onError: (error) => {
      setToast(error instanceof Error ? error.message : "Could not save the setting.");
    },
  });

  if (!isSuperAdmin) {
    return (
      <div className="page">
        <h1><ShieldCheck size={20} /> Platform Settings</h1>
        <p className="notice notice-warn">This area is limited to platform administrators.</p>
      </div>
    );
  }

  return (
    <div className="page platform-page">
      <header className="page-header">
        <div>
          <h1><Settings size={20} /> Platform Settings</h1>
          <p className="muted">Global defaults that apply across the installation rather than to one store.</p>
        </div>
        <span className="platform-scope-badge"><ShieldCheck size={14} /> Platform only</span>
      </header>

      {toast && <p className="platform-toast" role="status"><CheckCircle2 size={16} />{toast}</p>}

      <div className="platform-resource-grid">
        <section className="platform-panel">
          <div className="platform-section-heading">
            <div><h2>Installed settings</h2><p>Global platform configuration keys.</p></div>
            <span className="platform-panel-count">{resources.data?.settings.length ?? 0}</span>
          </div>

          <div className="platform-resource-list">
            {(resources.data?.settings ?? []).map((item) => (
              <button type="button" key={item.key} className="platform-resource-row platform-setting-select" onClick={() => { setSelectedKey(item.key); setJsonValue(JSON.stringify(item.value ?? {}, null, 2)); setDescription(item.description ?? ""); }}>
                <span><strong>{item.key}</strong><small>{item.description ?? "No description"}</small></span>
                <code>{JSON.stringify(item.value ?? {})}</code>
              </button>
            ))}
          </div>
        </section>

        <section className="platform-panel">
          <div className="platform-section-heading">
            <div><h2>Editor</h2><p>Update the selected platform setting.</p></div>
          </div>

          <div className="platform-resource-form platform-setting-form">
            <select value={selectedKey} onChange={(event) => {
              const key = event.target.value;
              const current = settingsMap.get(key) ?? selectedSetting;
              setSelectedKey(key);
              setJsonValue(JSON.stringify(current.value ?? {}, null, 2));
              setDescription(current.description ?? "");
            }}>
              {DEFAULT_KEYS.map((item) => <option key={item} value={item}>{item}</option>)}
              {(resources.data?.settings ?? []).filter((item) => !DEFAULT_KEYS.includes(item.key)).map((item) => <option key={item.key} value={item.key}>{item.key}</option>)}
            </select>

            <textarea value={jsonValue} onChange={(event) => setJsonValue(event.target.value)} placeholder='{"enabled": true}' />
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
            <button type="button" className="secondary-button" onClick={() => save.mutate()} disabled={save.isPending}>Save settings</button>
          </div>
        </section>
      </div>
    </div>
  );
}
