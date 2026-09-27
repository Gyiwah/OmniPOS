import { Link } from "react-router-dom";
import {
  ShoppingCart,
  Banknote,
  Box,
  Users,
  ArrowLeftRight,
  BarChart3,
  ChevronRight,
  Sparkles,
} from "lucide-react";

interface HubItem {
  label: string;
  subtitle: string;
  icon: typeof ShoppingCart;
  to: string;
  colorVar: string;
  tag?: string;
}

const HUB_ITEMS: HubItem[] = [
  {
    label: "POS Terminal",
    subtitle: "Checkout, barcode scanning & cart",
    icon: ShoppingCart,
    to: "/",
    colorVar: "#0767de",
    tag: "Core Till",
  },
  {
    label: "Cash Drawer",
    subtitle: "Shifts, float count & Z-Reports",
    icon: Banknote,
    to: "/shift",
    colorVar: "#16a34a",
  },
  {
    label: "Inventory & Batches",
    subtitle: "Stock levels, pricing & expiry tracking",
    icon: Box,
    to: "/products",
    colorVar: "#fe7403",
  },
  {
    label: "Customer CRM",
    subtitle: "Store credit, accounts & debt management",
    icon: Users,
    to: "/customers",
    colorVar: "#8b5cf6",
  },
  {
    label: "Returns & Refunds",
    subtitle: "Item restock, voids & reverse tender",
    icon: ArrowLeftRight,
    to: "/returns",
    colorVar: "#f43f5e",
  },
  {
    label: "Reports & Analytics",
    subtitle: "Profit margins, cashier reports & tax audit",
    icon: BarChart3,
    to: "/reports",
    colorVar: "#06b6d4",
  },
];

export function ManagementHub() {
  return (
    <section className="dashboard-card management-hub-card">
      <div className="card-header-flex">
        <div className="chart-title-group">
          <div className="chart-icon-badge badge-hub">
            <Sparkles size={18} aria-hidden="true" />
          </div>
          <div>
            <h3 className="card-heading">Store Management Hub</h3>
            <p className="card-subheading">Direct access to core POS operational modules</p>
          </div>
        </div>

        <span className="hub-counter-pill">{HUB_ITEMS.length} Modules</span>
      </div>

      <div className="hub-grid">
        {HUB_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              to={item.to}
              className="hub-tile"
              title={`Open ${item.label}`}
            >
              <div
                className="hub-icon-box"
                style={{
                  color: item.colorVar,
                  backgroundColor: `color-mix(in srgb, ${item.colorVar} 14%, transparent)`,
                }}
              >
                <Icon size={20} aria-hidden="true" />
              </div>

              <div className="hub-text-group">
                <div className="hub-title-row">
                  <strong className="hub-title">{item.label}</strong>
                  {item.tag && <span className="hub-tag">{item.tag}</span>}
                </div>
                <small className="hub-subtitle">{item.subtitle}</small>
              </div>

              <div className="hub-chevron">
                <ChevronRight size={16} />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
