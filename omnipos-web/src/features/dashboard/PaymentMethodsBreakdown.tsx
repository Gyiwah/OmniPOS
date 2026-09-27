import { useMemo } from "react";
import {
  Banknote,
  CreditCard,
  Smartphone,
  Building2,
  Wallet,
  Sparkles,
  Layers,
  HelpCircle,
} from "lucide-react";
import { formatMoney, toMinor } from "@/features/pos/cart";

interface PaymentMethodsBreakdownProps {
  payments: Record<string, { total: string; count: number }>;
  currency: string;
}

interface MethodMeta {
  label: string;
  icon: typeof Banknote;
  colorVar: string;
  colorHex: string;
}

const METHOD_CONFIG: Record<string, MethodMeta> = {
  cash: {
    label: "Cash",
    icon: Banknote,
    colorVar: "var(--ok)",
    colorHex: "#16a34a",
  },
  card: {
    label: "Card / Terminal",
    icon: CreditCard,
    colorVar: "#8b5cf6",
    colorHex: "#8b5cf6",
  },
  mobile_money: {
    label: "Mobile Money (MoMo)",
    icon: Smartphone,
    colorVar: "var(--cta)",
    colorHex: "#fe7403",
  },
  transfer: {
    label: "Bank Transfer",
    icon: Building2,
    colorVar: "#06b6d4",
    colorHex: "#06b6d4",
  },
  store_credit: {
    label: "Store Credit",
    icon: Wallet,
    colorVar: "#ec4899",
    colorHex: "#ec4899",
  },
  loyalty: {
    label: "Loyalty Points",
    icon: Sparkles,
    colorVar: "#eab308",
    colorHex: "#eab308",
  },
  other: {
    label: "Other Tender",
    icon: Layers,
    colorVar: "var(--muted)",
    colorHex: "#64748b",
  },
};

export function PaymentMethodsBreakdown({
  payments,
  currency,
}: PaymentMethodsBreakdownProps) {
  const { methodsList, grandTotal, totalTxns } = useMemo(() => {
    let sumTotal = 0;
    let sumTxns = 0;

    const list = Object.entries(payments ?? {}).map(([key, data]) => {
      const minor = toMinor(data.total);
      if (minor > 0) sumTotal += minor;
      sumTxns += data.count;
      return {
        key,
        totalMinor: minor,
        count: data.count,
        config: METHOD_CONFIG[key] ?? {
          label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          icon: Layers,
          colorVar: "var(--accent)",
          colorHex: "#0767de",
        },
      };
    });

    // Sort highest amount first
    list.sort((a, b) => b.totalMinor - a.totalMinor);

    return { methodsList: list, grandTotal: sumTotal, totalTxns: sumTxns };
  }, [payments]);

  return (
    <section className="dashboard-card payment-methods-card">
      <div className="card-header-flex">
        <div className="chart-title-group">
          <div className="chart-icon-badge badge-tender">
            <CreditCard size={18} aria-hidden="true" />
          </div>
          <div>
            <h3 className="card-heading">Payment Tender Distribution</h3>
            <p className="card-subheading">
              Breakdown of how customers paid across all terminals
            </p>
          </div>
        </div>

        <div className="tender-total-badge">
          <span>{totalTxns} payment{totalTxns === 1 ? "" : "s"} · Total:</span>
          <strong>{formatMoney(grandTotal, currency)}</strong>
        </div>
      </div>

      {methodsList.length === 0 ? (
        <div className="tender-empty-state">
          <p className="muted">No payments recorded in this period.</p>
        </div>
      ) : (
        <>
          {/* Stacked Proportional Bar */}
          <div className="tender-proportional-bar" aria-label="Payment proportions" role="meter">
            {methodsList.map((m) => {
              const pct = grandTotal > 0 ? (m.totalMinor / grandTotal) * 100 : 0;
              if (pct <= 0) return null;
              return (
                <div
                  key={m.key}
                  className="tender-bar-segment"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: m.config.colorHex,
                  }}
                  title={`${m.config.label}: ${formatMoney(m.totalMinor, currency)} (${pct.toFixed(1)}%)`}
                />
              );
            })}
          </div>

          {/* Individual Tender Cards */}
          <div className="tender-grid">
            {methodsList.map((m) => {
              const pct = grandTotal > 0 ? (m.totalMinor / grandTotal) * 100 : 0;
              const Icon = m.config.icon;

              return (
                <div key={m.key} className="tender-item-card">
                  <div className="tender-item-top">
                    <div
                      className="tender-item-icon"
                      style={{
                        color: m.config.colorHex,
                        backgroundColor: `color-mix(in srgb, ${m.config.colorHex} 14%, transparent)`,
                      }}
                    >
                      <Icon size={18} />
                    </div>
                    <div className="tender-item-meta">
                      <span className="tender-item-name">{m.config.label}</span>
                      <small className="tender-item-count">
                        {m.count} transaction{m.count === 1 ? "" : "s"}
                      </small>
                    </div>
                    <div className="tender-item-pct">
                      <span>{pct.toFixed(1)}%</span>
                    </div>
                  </div>

                  <div className="tender-item-total">
                    <strong>{formatMoney(m.totalMinor, currency)}</strong>
                  </div>

                  <div className="tender-item-progress">
                    <div
                      className="tender-progress-fill"
                      style={{
                        width: `${Math.min(100, Math.max(2, pct))}%`,
                        backgroundColor: m.config.colorHex,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="tender-explainer-note">
            <HelpCircle size={15} />
            <span>
              Real-time cash flow reflects money physically received or processed during this window, including debt recoveries.
            </span>
          </div>
        </>
      )}
    </section>
  );
}
