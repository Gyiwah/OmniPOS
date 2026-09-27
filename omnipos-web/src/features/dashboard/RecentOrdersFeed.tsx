import { Link } from "react-router-dom";
import { Receipt, CheckCircle2, Clock3, ChevronRight, ArrowRight, User } from "lucide-react";
import type { LocalOrder } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";

interface RecentOrdersFeedProps {
  orders: LocalOrder[];
  currency: string;
}

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);

    if (diffSec < 60) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24 && date.getDate() === now.getDate()) {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function RecentOrdersFeed({ orders, currency }: RecentOrdersFeedProps) {
  const displayOrders = orders.slice(0, 6);

  return (
    <section className="dashboard-card recent-orders-card">
      <div className="card-header-flex">
        <div className="chart-title-group">
          <div className="chart-icon-badge badge-receipt">
            <Receipt size={18} aria-hidden="true" />
          </div>
          <div>
            <h3 className="card-heading">Live Recent Sales</h3>
            <p className="card-subheading">Instant stream from this till and synced terminals</p>
          </div>
        </div>

        <Link to="/orders" className="card-action-link">
          <span>All Orders</span>
          <ArrowRight size={14} />
        </Link>
      </div>

      {displayOrders.length === 0 ? (
        <div className="orders-empty-state">
          <Receipt size={32} className="muted" />
          <p>No recent orders found.</p>
          <small className="muted">Completed sales at the till will appear here in real time.</small>
          <Link to="/" className="empty-cta-btn">
            Open Till & Sell
          </Link>
        </div>
      ) : (
        <div className="recent-orders-list">
          {displayOrders.map((order) => {
            const totalMinor = toMinor(order.total);
            const paidMinor = toMinor(order.amount_paid);
            const isPartial = paidMinor < totalMinor;
            const customerName = order.customer_name?.trim() || "Walk-in Customer";
            const timeAgo = formatRelativeTime(order.client_created_at);

            return (
              <Link
                key={order.id}
                to={`/receipt/${order.id}`}
                className="order-feed-item"
                title={`View Receipt for #${order.order_number}`}
              >
                <div className={`order-status-avatar ${isPartial ? "partial" : "paid"}`}>
                  {isPartial ? (
                    <Clock3 size={16} aria-hidden="true" />
                  ) : (
                    <CheckCircle2 size={16} aria-hidden="true" />
                  )}
                </div>

                <div className="order-main-info">
                  <div className="order-number-row">
                    <strong className="order-number">#{order.order_number}</strong>
                    <span className="order-timestamp">{timeAgo}</span>
                  </div>
                  <div className="order-customer-row">
                    <User size={13} className="order-user-icon" />
                    <span className="order-customer-name">{customerName}</span>
                  </div>
                </div>

                <div className="order-amount-group">
                  <strong className="order-total-price">
                    {formatMoney(totalMinor, currency)}
                  </strong>
                  <span className={`order-tag ${isPartial ? "tag-partial" : "tag-paid"}`}>
                    {isPartial ? "Partial / Credit" : "Paid in Full"}
                  </span>
                </div>

                <div className="order-arrow">
                  <ChevronRight size={16} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
