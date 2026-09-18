import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings } from "lucide-react";

import { api } from "@/api/client";
import {
  Field,
  PlatformDenied,
  PlatformPage,
  PlatformToast,
  usePlatformAccess,
  useToast,
} from "./PlatformChrome";

type SystemSetting = {
  key: string;
  value: Record<string, unknown> | null;
  description: string | null;
};

type Resources = {
  settings: SystemSetting[];
};

const PRESETS = [
  { key: "platform.maintenance", label: "Maintenance mode", description: "When enabled, stores are told the platform is under maintenance.", kind: "toggle" as const },
  { key: "platform.default_currency", label: "Default currency", description: "Used when a new store is provisioned.", kind: "text" as const, field: "code" },
  { key: "platform.default_timezone", label: "Default timezone", description: "IANA timezone for new tenants.", kind: "text" as const, field: "value" },
  { key: "platform.default_language", label: "Default language", description: "Language code offered to new stores.", kind: "text" as const, field: "value" },
  { key: "platform.notifications.email", label: "Email notifications", description: "Platform-level email alerts.", kind: "toggle" as const },
];

export function PlatformSettingsPage() {
  const isSuperAdmin = usePlatformAccess();
  const queryClient = useQueryClient();
  const { toast, setToast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const resources = useQuery({
    queryKey: ["admin-platform-settings"],
    queryFn: () => api.get<Resources>("/api/admin/system-resources", undefined, { storeless: true }),
    enabled: isSuperAdmin,
  });

  const settingsMap = useMemo(
    () => new Map((resources.data?.settings ?? []).map((item) => [item.key, item])),
    [resources.data],
  );

  const save = useMutation({
    mutationFn: ({ key, value, description }: { key: string; value: Record<string, unknown>; description: string }) =>
      api.patch(`/api/admin/system-resources/settings/${encodeURIComponent(key)}`, { value, description }, { storeless: true }),
    onSuccess: () => {
      setToast("Setting saved.");
      void queryClient.invalidateQueries({ queryKey: ["admin-platform-settings"] });
    },
    onError: (error) => setToast(error instanceof Error ? error.message : "Could not save the setting."),
  });

  if (!isSuperAdmin) return <PlatformDenied title="Settings" />;

  return (
    <PlatformPage
      icon={Settings}
      title="Platform settings"
      description="Installation defaults that apply before a store chooses its own values."
    >
      <PlatformToast message={toast} />
      <div className="platform-settings-stack">
        {PRESETS.map((preset) => {
          const current = settingsMap.get(preset.key);
          const record = current?.value ?? {};
          const enabled = Boolean(record.enabled);
          const field = preset.kind === "text" ? preset.field : "value";
          const storedText = String(record[field] ?? "");

          return (
            <section className="platform-panel" key={preset.key}>
              <div className="platform-section-heading">
                <div>
                  <h2>{preset.label}</h2>
                  <p>{preset.description}</p>
                </div>
                <code className="platform-setting-key">{preset.key}</code>
              </div>
              {preset.kind === "toggle" ? (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => save.mutate({
                      key: preset.key,
                      value: { ...record, enabled: e.target.checked },
                      description: current?.description ?? preset.description,
                    })}
                  />
                  Enabled
                </label>
              ) : (
                <form
                  className="platform-inline-save"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save.mutate({
                      key: preset.key,
                      value: { ...record, [field]: drafts[preset.key] ?? storedText },
                      description: current?.description ?? preset.description,
                    });
                  }}
                >
                  <Field id={preset.key} label={preset.label}>
                    <input
                      id={preset.key}
                      value={drafts[preset.key] ?? storedText}
                      onChange={(e) => setDrafts({ ...drafts, [preset.key]: e.target.value })}
                    />
                  </Field>
                  <button type="submit" className="secondary-button" disabled={save.isPending}>Save</button>
                </form>
              )}
            </section>
          );
        })}
      </div>
    </PlatformPage>
  );
}
