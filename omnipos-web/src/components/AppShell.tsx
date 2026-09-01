import { NavLink } from "react-router-dom";

import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";

const NAV = [
  { to: "/", label: "POS", end: true },
  { to: "/dashboard", label: "Dashboard", roles: ["admin", "manager"] },
  { to: "/reports", label: "Reports" },
  { to: "/orders", label: "Orders" },
  { to: "/returns", label: "Returns" },
  { to: "/shift", label: "Drawer" },
  { to: "/products", label: "Inventory" },
  { to: "/customers", label: "Customers" },
  { to: "/settings", label: "Settings", roles: ["admin", "manager"] },
  { to: "/sync", label: "Sync" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const user = useSession((s) => s.user);
  const store = useSession((s) => s.store);
  const storeId = useSession((s) => s.storeId);
  const memberships = useSession((s) => s.memberships);
  const selectStore = useSession((s) => s.selectStore);
  const can = useSession((s) => s.can);
  const role = useSession((s) => s.role)();
  const logout = useSession((s) => s.logout);

  const online = useSync((s) => s.online);
  const pending = useSync((s) => s.pending);
  const conflicts = useSync((s) => s.conflicts);

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="brand">
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
            store && <span className="muted"> · {store.name}</span>
          )}
        </div>

        <nav className="shell-nav">
          {NAV.filter((item) => !item.roles || can(item.roles)).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
              {item.label}
              {item.to === "/sync" && conflicts.length > 0 && <span className="badge badge-error">{conflicts.length}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="shell-status">
          {/*
            Connection state is always visible. A cashier needs to know whether
            a sale has reached the server, and the honest answer is often "not
            yet" — hiding that is how tills get trusted less, not more.
          */}
          <span className={online ? "pill pill-online" : "pill pill-offline"}>
            {online ? "Online" : "Offline"}
          </span>
          {pending > 0 && (
            <span className="pill pill-pending" title="Sales waiting to reach the server">
              {pending} queued
            </span>
          )}
          <span className="muted">{user?.name}{role && ` · ${role}`}</span>
          <button type="button" className="link" onClick={() => void logout()}>Sign out</button>
        </div>
      </header>

      <main className="shell-main">{children}</main>
    </div>
  );
}
