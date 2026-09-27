import { Link } from "react-router-dom";
import { Clock3, AlertTriangle, ArrowRight, ShieldCheck, Calendar } from "lucide-react";

export interface DashboardExpiringBatch {
  id: string;
  name: string;
  batch_number: string | null;
  quantity: string | number;
  expiry_date: string;
  status: "expired" | "expiring_soon";
  label: string;
  daysRemaining: number | null;
}

interface ExpiringInventoryAlertProps {
  batches: DashboardExpiringBatch[];
  expiredCount: number;
  expiringSoonCount: number;
  isLoading?: boolean;
}

export function ExpiringInventoryAlert({
  batches,
  expiredCount,
  expiringSoonCount,
  isLoading = false,
}: ExpiringInventoryAlertProps) {
  const totalAlerts = expiredCount + expiringSoonCount;

  if (isLoading) {
    return (
      <div className="action-alert-banner alert-warn-theme">
        <div className="alert-left-content">
          <div className="alert-icon-wrap">
            <Clock3 size={18} />
          </div>
          <div className="alert-text-stack">
            <strong>Checking batch shelf life…</strong>
            <small>Scanning local and remote product batches for upcoming expiry dates</small>
          </div>
        </div>
      </div>
    );
  }

  if (totalAlerts === 0) {
    return (
      <div className="action-alert-banner alert-healthy-theme">
        <div className="alert-left-content">
          <div className="alert-icon-wrap healthy-wrap">
            <ShieldCheck size={18} />
          </div>
          <div className="alert-text-stack">
            <strong>Inventory Shelf-Life: Optimal</strong>
            <small>All active product batches are within safe shelf-life limits (no batches expiring within 30 days).</small>
          </div>
        </div>
        <Link to="/products" className="alert-action-pill">
          <span>View Inventory</span>
          <ArrowRight size={13} />
        </Link>
      </div>
    );
  }

  // Display up to 4 urgent items
  const displayBatches = batches.slice(0, 4);

  return (
    <section className="dashboard-card expiring-alert-card">
      <div className="card-header-flex">
        <div className="chart-title-group">
          <div className={`chart-icon-badge ${expiredCount > 0 ? "badge-danger" : "badge-warn"}`}>
            {expiredCount > 0 ? <AlertTriangle size={18} /> : <Clock3 size={18} />}
          </div>
          <div>
            <h3 className="card-heading">
              Expiring Inventory Watchdog
            </h3>
            <p className="card-subheading">
              {expiredCount > 0
                ? `${expiredCount} batch${expiredCount === 1 ? "" : "es"} expired and ${expiringSoonCount} expiring soon (<30d)`
                : `${expiringSoonCount} batch${expiringSoonCount === 1 ? "" : "es"} expiring within the next 30 days`}
            </p>
          </div>
        </div>

        <div className="expiry-alert-actions">
          {expiredCount > 0 && (
            <span className="expiry-count-badge badge-expired">
              {expiredCount} Expired
            </span>
          )}
          {expiringSoonCount > 0 && (
            <span className="expiry-count-badge badge-soon">
              {expiringSoonCount} Expiring Soon
            </span>
          )}
          <Link to="/products" className="card-action-link">
            <span>Manage Batches</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      <div className="expiring-batch-list">
        {displayBatches.map((b) => {
          const isExpired = b.status === "expired";
          const formattedDate = b.expiry_date
            ? new Date(b.expiry_date).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : "No date";

          return (
            <div key={b.id} className={`expiring-batch-row ${isExpired ? "row-expired" : "row-soon"}`}>
              <div className="batch-info-left">
                <strong className="batch-product-name">{b.name}</strong>
                <div className="batch-meta-line">
                  {b.batch_number ? (
                    <span className="batch-number-tag">Batch: {b.batch_number}</span>
                  ) : (
                    <span className="batch-number-tag">No Batch #</span>
                  )}
                  <span className="batch-qty-tag">{b.quantity} in stock</span>
                </div>
              </div>

              <div className="batch-info-right">
                <div className="batch-expiry-date">
                  <Calendar size={13} />
                  <span>{formattedDate}</span>
                </div>
                <span className={`batch-status-pill ${isExpired ? "pill-expired" : "pill-soon"}`}>
                  {b.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {batches.length > 4 && (
        <div className="expiring-footer-note">
          <small className="muted">
            + {batches.length - 4} more batch{batches.length - 4 === 1 ? "" : "es"} nearing shelf-life threshold.
          </small>
          <Link to="/products" className="expiring-view-all-link">
            Open Inventory Filtered View
          </Link>
        </div>
      )}
    </section>
  );
}
