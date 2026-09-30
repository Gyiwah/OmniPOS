import { useMemo } from "react";
import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BarChart3,
  Banknote,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Package,
  Receipt,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sun,
  Users,
} from "lucide-react";

import { api } from "@/api/client";
import { PLATFORM_GROUPS } from "@/features/superAdmin/platformNav";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { nextThemeLabel, useTheme } from "@/state/theme";

import { ToastContainer } from "./ToastContainer";

type AccessibleStoreItem = {
  id: string;
  name: string;
  is_branch?: boolean;
  parent_store_id?: string | null;
};

const NAV = [
  { to: "/", label: "Till", icon: ShoppingCart, end: true },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "manager"] },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/orders", label: "Orders", icon: Receipt },
  { to: "/returns", label: "Returns", icon: ArrowLeftRight },
  { to: "/shift", label: "Drawer", icon: Banknote },
  { to: "/products", label: "Inventory", icon: Package, roles: ["admin", "manager"] },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["admin", "manager"] },
  { to: "/sync", label: "Sync", icon: RefreshCw },
  // Only a platform administrator. `can` grants super_admin everything, so the
  // role is named explicitly rather than relying on that.
  { to: "/platform", label: "Platform", icon: ShieldCheck, superAdminOnly: true },
];

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor };

export function AppShell({ children }: { children: React.ReactNode }) {
  const user = useSession((s) => s.user);
  const store = useSession((s) => s.store);
  const storeId = useSession((s) => s.storeId);
  const memberships = useSession((s) => s.memberships);
  const selectStore = useSession((s) => s.selectStore);
  const can = useSession((s) => s.can);
  const role = useSession((s) => s.role)();
  const isSuperAdmin = user?.is_super_admin === true;
  const logout = useSession((s) => s.logout);

  const conflicts = useSync((s) => s.conflicts);

  const themeChoice = useTheme((s) => s.choice);
  const cycleTheme = useTheme((s) => s.cycle);
  const ThemeIcon = THEME_ICON[themeChoice];

  // Fetch accessible stores (including branch stores) and cache for offline switching
  const storesQuery = useQuery({
    queryKey: ["user-accessible-stores"],
    queryFn: async () => {
      try {
        const res = (await api.get<{ data: AccessibleStoreItem[] }>("/api/stores")).data ?? [];
        localStorage.setItem("omnipos_accessible_stores", JSON.stringify(res));
        return res;
      } catch (err) {
        const cached = localStorage.getItem("omnipos_accessible_stores");
        if (cached) {
          try {
            return JSON.parse(cached) as AccessibleStoreItem[];
          } catch {}
        }
        return [];
      }
    },
    enabled: Boolean(user),
  });

  const availableStores = useMemo(() => {
    const list: AccessibleStoreItem[] = [...(storesQuery.data ?? [])];
    if (list.length === 0) {
      const cached = localStorage.getItem("omnipos_accessible_stores");
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as AccessibleStoreItem[];
          if (parsed.length > 0) list.push(...parsed);
        } catch {}
      }
    }
    // Ensure active store is present
    if (store && !list.some((s) => s.id === store.id)) {
      list.unshift({ id: store.id, name: store.name, is_branch: false, parent_store_id: null });
    }
    // Fallback synthesis from memberships if list is still empty
    if (list.length === 0 && memberships.length > 0) {
      return memberships.map((m) => ({
        id: m.store_id,
        name: m.store_id === storeId && store ? store.name : `Store #${m.store_id.slice(0, 8)}`,
        is_branch: false,
        parent_store_id: null,
      }));
    }
    return list;
  }, [storesQuery.data, store, storeId, memberships]);

  return (
    <div className={`shell${isSuperAdmin ? " shell-platform" : ""}`}>
      <header className="shell-header">
        <div className="brand">
          <div className="brand-identity">
            <img src="/android-chrome-192x192.png" alt="OmniPOS" className="brand-image" />
            <strong>OmniPOS</strong>
          </div>
          {/*
            Allow switching between all accessible stores and branches with real names.
            Works smoothly offline via cached store metadata.
          */}
          {availableStores.length > 1 ? (
            <select
              className="store-picker"
              aria-label="Active store"
              value={storeId ?? ""}
              onChange={(e) => void selectStore(e.target.value)}
            >
              {availableStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.is_branch ? " (Branch)" : ""}
                </option>
              ))}
            </select>
          ) : (
            store && <span className="muted brand-store-name">{store.name}</span>
          )}
        </div>

        <nav className="shell-nav">
          {isSuperAdmin ? (
            <>
              {PLATFORM_GROUPS.flatMap((group) => group.items).map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
                    <Icon size={17} aria-hidden="true" />
                    <span className="nav-label">{item.label}</span>
                  </NavLink>
                );
              })}
            </>
          ) : NAV.filter((item) => {
            if ("superAdminOnly" in item) return user?.is_super_admin === true;
            return !item.roles || can(item.roles);
          }).map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                <Icon size={17} aria-hidden="true" />
                <span className="nav-label">{item.label}</span>
                {item.to === "/sync" && conflicts.length > 0 && (
                  <span className="badge badge-error">{conflicts.length}</span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="shell-status">
          <div className="status-row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <span className="muted who" style={{ fontSize: "0.82rem" }}>
              {user?.name}
              {role && ` · ${role}`}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.2rem", flexShrink: 0 }}>
              <button
                type="button"
                className="icon-button"
                onClick={cycleTheme}
                title={nextThemeLabel(themeChoice)}
                aria-label={nextThemeLabel(themeChoice)}
              >
                <ThemeIcon size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => void logout()}
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="shell-main">{children}</main>
      <ToastContainer />
    </div>
  );
}
