import { NavLink } from "react-router-dom";
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

import { PLATFORM_GROUPS } from "@/features/superAdmin/platformNav";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { nextThemeLabel, useTheme } from "@/state/theme";
import { SyncStatusBadge } from "./SyncStatusBadge";

import { ToastContainer } from "./ToastContainer";

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

  return (
    <div className={`shell${isSuperAdmin ? " shell-platform" : ""}`}>
      <header className="shell-header">
        <div className="brand">
          <img src="/android-chrome-192x192.png" alt="OmniPOS" className="brand-image" />
          <strong>OmniPOS</strong>
          {/*
            One store is the normal case and a dropdown for a single option is
            just noise, so the picker only appears for someone who actually
            belongs to more than one. Switching wipes local data, because a
            catalogue and a stock figure belong to exactly one shop.
          */}
          {memberships.length > 1 ? (
            <select
              className="store-picker"
              aria-label="Active store"
              value={storeId ?? ""}
              onChange={(e) => void selectStore(e.target.value)}
            >
              {memberships.map((m) => (
                <option key={m.store_id} value={m.store_id}>
                  {m.store_id === storeId && store ? store.name : m.store_id.slice(0, 8)}
                </option>
              ))}
            </select>
          ) : (
            store && <span className="muted">{store.name}</span>
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
          {/* Connection and sync state */}
          <div className="status-row" style={{ alignItems: "center" }}>
            <SyncStatusBadge />
          </div>

          <div className="status-row">
            <span className="muted who">
              {user?.name}
              {role && ` · ${role}`}
            </span>
          </div>

          <div className="status-row">
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
            >
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="shell-main">{children}</main>
      <ToastContainer />
    </div>
  );
}
