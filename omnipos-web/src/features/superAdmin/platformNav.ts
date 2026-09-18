import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  LayoutDashboard,
  MonitorSmartphone,
  Network,
  Receipt,
  ScrollText,
  Settings,
  Store,
  UserCog,
} from "lucide-react";

export type PlatformNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  description: string;
};

export type PlatformNavGroup = {
  label: string;
  items: PlatformNavItem[];
};

export const PLATFORM_GROUPS: PlatformNavGroup[] = [
  {
    label: "Overview",
    items: [
      { to: "/platform", label: "Dashboard", icon: LayoutDashboard, end: true, description: "Health, usage, and shortcuts across the platform." },
    ],
  },
  {
    label: "Tenants",
    items: [
      { to: "/platform/stores", label: "Stores", icon: Store, description: "Provision tenants, lifecycle status, and owners." },
      { to: "/platform/branches", label: "Branches", icon: Boxes, description: "Attach branches to parent stores and control access." },
      { to: "/platform/people", label: "People", icon: UserCog, description: "Memberships, store roles, and platform-admin flags." },
    ],
  },
  {
    label: "Services",
    items: [
      { to: "/platform/devices", label: "Devices", icon: MonitorSmartphone, description: "Registered terminals and device lifecycle." },
      { to: "/platform/resources", label: "Catalogues", icon: Boxes, description: "Global categories shared with every store." },
      { to: "/platform/subscriptions", label: "Billing", icon: Receipt, description: "Plans, limits, and store subscriptions." },
      { to: "/platform/synchronization", label: "Sync", icon: Network, description: "Queue health, conflicts, and failed operations." },
    ],
  },
  {
    label: "Governance",
    items: [
      { to: "/platform/reports", label: "Reports", icon: BarChart3, description: "Cross-tenant summaries for operators." },
      { to: "/platform/audit-logs", label: "Audit", icon: ScrollText, description: "Immutable trail of platform actions." },
      { to: "/platform/settings", label: "Settings", icon: Settings, description: "Installation defaults and maintenance mode." },
    ],
  },
];
