import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Clock,
  DollarSign,
  Languages,
  RefreshCw,
  Save,
  Server,
  Settings,
  ShieldAlert,
} from "lucide-react";

import { api } from "@/api/client";
import {
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

type PresetConfig = {
  key: string;
  label: string;
  category: "operations" | "localization" | "notifications";
  description: string;
  icon: typeof Settings;
  kind: "toggle" | "currency" | "timezone" | "language" | "text";
  field: string;
};

const PRESETS: PresetConfig[] = [
  {
    key: "platform.maintenance",
    label: "Platform Maintenance Mode",
    category: "operations",
    description: "When active, tenant stores and cashiers are alerted that system upgrades are underway. Non-super-admin access is restricted.",
    icon: ShieldAlert,
    kind: "toggle",
    field: "enabled",
  },
  {
    key: "platform.default_currency",
    label: "Default Tenant Currency",
    category: "localization",
    description: "Standard currency ISO code applied during new store organization provisioning.",
    icon: DollarSign,
    kind: "currency",
    field: "code",
  },
  {
    key: "platform.default_timezone",
    label: "Default Regional Timezone",
    category: "localization",
    description: "Standard IANA timezone for tenant shift tracking, receipts, and daily sales rollups.",
    icon: Clock,
    kind: "timezone",
    field: "value",
  },
  {
    key: "platform.default_language",
    label: "Default Interface Language",
    category: "localization",
    description: "Primary locale code presented to newly provisioned store staff and till terminals.",
    icon: Languages,
    kind: "language",
    field: "value",
  },
  {
    key: "platform.notifications.email",
    label: "Platform Email Incident Alerts",
    category: "notifications",
    description: "Global email notifications for critical platform incidents, sync conflicts, and security alerts.",
    icon: Bell,
    kind: "toggle",
    field: "enabled",
  },
];

const CURRENCY_OPTIONS = [
  { code: "GHS", label: "GHS — Ghanaian Cedi (GH₵)" },
  { code: "USD", label: "USD — US Dollar ($)" },
  { code: "EUR", label: "EUR — Euro (€)" },
  { code: "GBP", label: "GBP — British Pound (£)" },
  { code: "NGN", label: "NGN — Nigerian Naira (₦)" },
  { code: "KES", label: "KES — Kenyan Shilling (KSh)" },
  { code: "ZAR", label: "ZAR — South African Rand (R)" },
  { code: "CAD", label: "CAD — Canadian Dollar ($)" },
];

const TIMEZONE_OPTIONS = [
  { value: "Africa/Accra", label: "Africa/Accra (GMT+0)" },
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
  { value: "Africa/Lagos", label: "Africa/Lagos (GMT+1)" },
  { value: "Africa/Nairobi", label: "Africa/Nairobi (GMT+3)" },
  { value: "Africa/Johannesburg", label: "Africa/Johannesburg (GMT+2)" },
  { value: "Europe/London", label: "Europe/London (GMT+0 / BST)" },
  { value: "America/New_York", label: "America/New_York (EST / EDT)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GST+4)" },
];

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English (en)" },
  { value: "fr", label: "Français (fr)" },
  { value: "es", label: "Español (es)" },
  { value: "ar", label: "العربية (ar)" },
];

export function PlatformSettingsPage() {
  const isSuperAdmin = usePlatformAccess();
  const queryClient = useQueryClient();
  const { toast, setToast } = useToast();

  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);

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
    mutationFn: ({
      key,
      value,
      description,
    }: {
      key: string;
      value: Record<string, unknown>;
      description: string;
    }) =>
      api.patch(
        `/api/admin/system-resources/settings/${encodeURIComponent(key)}`,
        { value, description },
        { storeless: true },
      ),
    onSuccess: (_, variables) => {
      setToast(`Setting '${variables.key}' saved successfully.`);
      // Clear draft for this key
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[variables.key];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["admin-platform-settings"] });
    },
    onError: (error) => setToast(error instanceof Error ? error.message : "Could not save the setting."),
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await resources.refetch();
    setIsRefreshing(false);
  };

  if (!isSuperAdmin) return <PlatformDenied title="Settings" />;

  // Maintenance mode active state
  const maintenanceSetting = settingsMap.get("platform.maintenance");
  const isMaintenanceActive = Boolean(maintenanceSetting?.value?.enabled);

  const filteredPresets = PRESETS.filter(
    (p) => activeCategory === "all" || p.category === activeCategory,
  );

  return (
    <PlatformPage
      icon={Settings}
      title="Platform Installation Settings"
      description="Global configurations, maintenance mode, regional localization defaults, and platform alerting policies."
      actions={
        <button
          type="button"
          className="secondary-button"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
          title="Refresh platform settings from server"
        >
          <RefreshCw size={15} className={isRefreshing ? "spin-icon" : ""} aria-hidden="true" />
          <span>{isRefreshing ? "Refreshing…" : "Refresh"}</span>
        </button>
      }
    >
      <PlatformToast message={toast} />

      {/* Critical Maintenance Mode Alert Banner if Active */}
      {isMaintenanceActive && (
        <div className="platform-alert-banner banner-danger" role="alert">
          <div className="platform-banner-content">
            <span className="platform-pulse-dot" />
            <ShieldAlert size={18} aria-hidden="true" />
            <div>
              <strong>Platform Maintenance Mode is currently ACTIVE</strong>
              <div style={{ fontSize: "0.78rem", fontWeight: 400, opacity: 0.9 }}>
                Stores and till registers may receive maintenance restrictions until disabled.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="secondary-button"
            style={{ fontSize: "0.76rem", padding: "0.3rem 0.65rem", background: "white", color: "#dc2626" }}
            onClick={() =>
              save.mutate({
                key: "platform.maintenance",
                value: { ...maintenanceSetting?.value, enabled: false },
                description: maintenanceSetting?.description ?? "Platform maintenance mode",
              })
            }
          >
            Disable Maintenance Mode
          </button>
        </div>
      )}

      {/* Category Navigation Pills */}
      <div className="platform-toolbar-pro" style={{ marginBottom: "1.25rem" }}>
        <div className="platform-toolbar-left">
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
            Sections:
          </span>
          <div className="platform-chip-group">
            <button
              type="button"
              className={`platform-chip ${activeCategory === "all" ? "active" : ""}`}
              onClick={() => setActiveCategory("all")}
            >
              All Settings ({PRESETS.length})
            </button>
            <button
              type="button"
              className={`platform-chip ${activeCategory === "operations" ? "active" : ""}`}
              onClick={() => setActiveCategory("operations")}
            >
              Operations & Maintenance
            </button>
            <button
              type="button"
              className={`platform-chip ${activeCategory === "localization" ? "active" : ""}`}
              onClick={() => setActiveCategory("localization")}
            >
              Regional Defaults
            </button>
            <button
              type="button"
              className={`platform-chip ${activeCategory === "notifications" ? "active" : ""}`}
              onClick={() => setActiveCategory("notifications")}
            >
              Alerts & Communications
            </button>
          </div>
        </div>
        <div className="platform-toolbar-right">
          <span className="platform-panel-count" title="Configured settings in current view">
            {filteredPresets.length}
          </span>
        </div>
      </div>

      {/* Settings Stack */}
      <div className="platform-settings-grid">
        {filteredPresets.map((preset) => {
          const current = settingsMap.get(preset.key);
          const record = current?.value ?? {};
          const Icon = preset.icon;

          if (preset.kind === "toggle") {
            const enabled = Boolean(record.enabled);

            return (
              <section className="platform-setting-card" key={preset.key}>
                <div className="platform-setting-row">
                  <div className="platform-setting-meta">
                    <h3>
                      <Icon size={16} aria-hidden="true" style={{ color: "var(--accent-text)" }} />
                      {preset.label}
                    </h3>
                    <p>{preset.description}</p>
                    <code className="platform-setting-key" style={{ marginTop: "0.25rem" }}>
                      {preset.key}
                    </code>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
                    <span
                      style={{
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: enabled ? "var(--ok)" : "var(--muted)",
                      }}
                    >
                      {enabled ? "ENABLED" : "DISABLED"}
                    </span>
                    <label className="platform-switch" title={`Toggle ${preset.label}`}>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) =>
                          save.mutate({
                            key: preset.key,
                            value: { ...record, enabled: e.target.checked },
                            description: current?.description ?? preset.description,
                          })
                        }
                        disabled={save.isPending}
                      />
                      <span className="platform-slider" />
                    </label>
                  </div>
                </div>
              </section>
            );
          }

          // Non-toggle settings: currency, timezone, language, or text
          const field = preset.field;
          const storedValue = String(record[field] ?? "");
          const currentDraft = drafts[preset.key] !== undefined ? drafts[preset.key] : storedValue;
          const isDirty = drafts[preset.key] !== undefined && drafts[preset.key] !== storedValue;

          return (
            <section className="platform-setting-card" key={preset.key}>
              <div className="platform-setting-row">
                <div className="platform-setting-meta">
                  <h3>
                    <Icon size={16} aria-hidden="true" style={{ color: "var(--accent-text)" }} />
                    {preset.label}
                  </h3>
                  <p>{preset.description}</p>
                  <code className="platform-setting-key" style={{ marginTop: "0.25rem" }}>
                    {preset.key} · Current: <b>{storedValue || "None configured"}</b>
                  </code>
                </div>

                <form
                  className="platform-input-group"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save.mutate({
                      key: preset.key,
                      value: { ...record, [field]: currentDraft },
                      description: current?.description ?? preset.description,
                    });
                  }}
                >
                  {preset.kind === "currency" ? (
                    <select
                      value={currentDraft}
                      onChange={(e) => setDrafts({ ...drafts, [preset.key]: e.target.value })}
                      aria-label={preset.label}
                    >
                      <option value="" disabled>
                        Select Currency…
                      </option>
                      {CURRENCY_OPTIONS.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  ) : preset.kind === "timezone" ? (
                    <select
                      value={currentDraft}
                      onChange={(e) => setDrafts({ ...drafts, [preset.key]: e.target.value })}
                      aria-label={preset.label}
                    >
                      <option value="" disabled>
                        Select Timezone…
                      </option>
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <option key={tz.value} value={tz.value}>
                          {tz.label}
                        </option>
                      ))}
                    </select>
                  ) : preset.kind === "language" ? (
                    <select
                      value={currentDraft}
                      onChange={(e) => setDrafts({ ...drafts, [preset.key]: e.target.value })}
                      aria-label={preset.label}
                    >
                      <option value="" disabled>
                        Select Language…
                      </option>
                      {LANGUAGE_OPTIONS.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={currentDraft}
                      onChange={(e) => setDrafts({ ...drafts, [preset.key]: e.target.value })}
                      placeholder="Enter setting value…"
                      aria-label={preset.label}
                    />
                  )}

                  <button
                    type="submit"
                    className={isDirty ? "pay-button" : "secondary-button"}
                    disabled={save.isPending || !isDirty}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    <Save size={14} aria-hidden="true" />
                    <span>{isDirty ? "Save Changes" : "Saved"}</span>
                  </button>
                </form>
              </div>
            </section>
          );
        })}
      </div>

      {/* Platform System Architecture Notice */}
      <div
        style={{
          marginTop: "1.5rem",
          padding: "1rem 1.25rem",
          borderRadius: "var(--radius)",
          background: "var(--panel-2)",
          border: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: "0.85rem",
        }}
      >
        <Server size={20} style={{ color: "var(--accent-text)", flexShrink: 0 }} aria-hidden="true" />
        <div style={{ fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.45 }}>
          <strong style={{ color: "var(--text-strong)" }}>Platform Governance Architecture:</strong> Settings configured on this page serve as installation-wide defaults and system gates. Existing tenant stores preserve their configured branch-level overrides unless explicitly reset by an administrator.
        </div>
      </div>
    </PlatformPage>
  );
}
