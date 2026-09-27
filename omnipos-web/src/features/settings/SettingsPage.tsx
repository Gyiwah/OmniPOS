import { useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import {
  Settings,
  Building2,
  Printer,
  Tag,
  Users,
  GitBranch,
  ShieldCheck,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  Store,
} from "lucide-react";

import { api, ApiError } from "@/api/client";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";

import { StoreSettingsTab, StoreSettings } from "./StoreSettingsTab";
import { HardwareSettingsTab } from "./HardwareSettingsTab";
import { CategoriesSettingsTab } from "./CategoriesSettingsTab";
import { StaffSettingsTab } from "./StaffSettingsTab";
import { BranchesSettingsTab } from "./BranchesSettingsTab";

import "./settings.css";

type TabId = "store" | "hardware" | "categories" | "staff" | "branches";

interface TabDefinition {
  id: TabId;
  label: string;
  icon: typeof Building2;
  adminOnly?: boolean;
}

const TABS: TabDefinition[] = [
  { id: "store", label: "Store & Taxes", icon: Building2 },
  { id: "hardware", label: "Hardware & Printer", icon: Printer },
  { id: "categories", label: "Product Categories", icon: Tag },
  { id: "staff", label: "Staff & Access", icon: Users },
  { id: "branches", label: "Branches", icon: GitBranch, adminOnly: true },
];

export function SettingsPage() {
  const can = useSession((s) => s.can);
  const store = useSession((s) => s.store);
  const storeId = useSession((s) => s.storeId);
  const syncOnline = useSync((s) => s.online);
  const syncRunning = useSync((s) => s.running);

  const isAdmin = can(["admin"]);
  const hasAccess = can(["admin", "manager"]);

  const [searchParams, setSearchParams] = useSearchParams();
  const [, startTransition] = useTransition();

  const tabParam = searchParams.get("tab") as TabId | null;
  const initialTab: TabId =
    tabParam && TABS.some((t) => t.id === tabParam && (!t.adminOnly || isAdmin))
      ? tabParam
      : "store";

  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  const handleTabChange = (newTab: TabId) => {
    setActiveTab(newTab);
    startTransition(() => {
      setSearchParams({ tab: newTab });
    });
  };

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["store-settings", storeId],
    queryFn: async () => (await api.get<{ data: StoreSettings }>("/api/store")).data,
    enabled: Boolean(storeId) && hasAccess,
  });

  // Access denied guard
  if (!hasAccess) {
    return (
      <div className="settings-root">
        <div className="action-alert-banner alert-warn-theme" role="status">
          <div className="alert-left-content">
            <div className="alert-icon-wrap">
              <ShieldCheck size={18} />
            </div>
            <div className="alert-text-stack">
              <strong>Settings Access Restricted</strong>
              <small>
                Store configuration, tax rates, categories, and staff administration are restricted to managers and
                administrators.
              </small>
            </div>
          </div>
          <Link to="/" className="alert-action-pill">
            <ArrowLeft size={14} />
            <span>Return to Till</span>
          </Link>
        </div>
      </div>
    );
  }

  // Loading skeleton state
  if (isLoading && !data) {
    return (
      <div className="settings-root">
        <div className="dashboard-skeleton-wrap">
          <div className="skeleton-box skeleton-hero" style={{ height: "6.5rem" }} />
          <div className="skeleton-box" style={{ height: "3.5rem" }} />
          <div className="skeleton-box skeleton-chart" style={{ height: "22rem" }} />
        </div>
      </div>
    );
  }

  // Server Unreachable or Error State
  if (error || !data) {
    const offline = error instanceof ApiError && error.isUnreachable;

    return (
      <div className="settings-root">
        <header className="settings-topbar">
          <div className="dashboard-greeting-block">
            <h1 className="dashboard-main-title">
              <Settings size={24} aria-hidden="true" />
              <span>Store Settings</span>
            </h1>
            <div className="dashboard-clock-row">
              <span>{store?.name ?? "OmniPOS Store"}</span>
            </div>
          </div>

          <button
            type="button"
            className="dashboard-refresh-btn"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw size={14} className={isRefetching ? "spin-icon" : ""} />
            <span>Retry Connection</span>
          </button>
        </header>

        <div className="action-alert-banner alert-warn-theme" role="status">
          <div className="alert-left-content">
            <div className="alert-icon-wrap">
              <AlertTriangle size={18} />
            </div>
            <div className="alert-text-stack">
              <strong>
                {offline
                  ? "Store settings require a server connection"
                  : "Could not load store configuration"}
              </strong>
              <small>
                {offline
                  ? "Changing tax rates, categories, and staff roles requires a live server connection. However, your local thermal receipt printer remains 100% configurable below."
                  : error instanceof Error
                    ? error.message
                    : "Please verify network connectivity and try again."}
              </small>
            </div>
          </div>
        </div>

        {/* Hardware printer stays 100% functional offline */}
        <HardwareSettingsTab />
      </div>
    );
  }

  const availableTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin);

  return (
    <div className="settings-root">
      {/* --- Executive Hero Strip --- */}
      <section className="settings-hero-card">
        <div className="settings-store-identity">
          <div className="settings-store-avatar">
            <Store size={24} />
          </div>
          <div className="settings-store-meta">
            <h1 className="settings-store-heading">
              <span>{data.name || "Store Configuration"}</span>
            </h1>
            <div className="settings-store-sub">
              <span className={`settings-pill-badge ${isAdmin ? "badge-admin" : "badge-manager"}`}>
                <ShieldCheck size={12} />
                {isAdmin ? "Administrator Clearance" : "Store Manager"}
              </span>
              <span>·</span>
              <span className="live-pulse-badge">
                <i className="live-pulse-dot" style={{ background: syncOnline ? "var(--ok)" : "var(--cta)" }} />
                {syncOnline ? "Connected & Synchronized" : "Offline Cache"}
              </span>
              {syncRunning && <span>(Syncing…)</span>}
            </div>
          </div>
        </div>

        <div className="settings-hero-stats">
          <div className="settings-quick-chip">
            <strong>{data.currency || "USD"}</strong>
            <span>Active Currency</span>
          </div>
          <div className="settings-quick-chip">
            <strong>{data.timezone || "UTC"}</strong>
            <span>Operating Timezone</span>
          </div>
          <Link to="/" className="hero-btn-secondary" title="Open POS Till Checkout">
            <ArrowLeft size={14} />
            <span>Till Register</span>
          </Link>
        </div>
      </section>

      {/* --- Navigation Tabs Bar --- */}
      <nav className="settings-nav-bar" role="tablist" aria-label="Settings Categories">
        {availableTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`settings-nav-tab ${isActive ? "active" : ""}`}
              onClick={() => handleTabChange(tab.id)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* --- Active Tab Panes --- */}
      {activeTab === "store" && (
        <StoreSettingsTab settings={data} canEdit={isAdmin} />
      )}

      {activeTab === "hardware" && (
        <HardwareSettingsTab />
      )}

      {activeTab === "categories" && (
        <CategoriesSettingsTab />
      )}

      {activeTab === "staff" && (
        <StaffSettingsTab />
      )}

      {activeTab === "branches" && isAdmin && (
        <BranchesSettingsTab />
      )}
    </div>
  );
}
