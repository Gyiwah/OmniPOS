import { Link } from "react-router-dom";
import { Award, ArrowRight, Package } from "lucide-react";
import { formatMoney, toMinor } from "@/features/pos/cart";

interface TopProductItem {
  product_id: string;
  name: string;
  units: number;
  revenue: string;
}

interface TopProductsLeaderboardProps {
  products: TopProductItem[];
  currency: string;
}

const RANK_BADGES = [
  { label: "#1", medal: "🥇", className: "rank-gold" },
  { label: "#2", medal: "🥈", className: "rank-silver" },
  { label: "#3", medal: "🥉", className: "rank-bronze" },
  { label: "#4", medal: "4", className: "rank-standard" },
  { label: "#5", medal: "5", className: "rank-standard" },
];

export function TopProductsLeaderboard({
  products,
  currency,
}: TopProductsLeaderboardProps) {
  const maxRevenue = Math.max(
    ...products.map((p) => toMinor(p.revenue)),
    1,
  );

  return (
    <section className="dashboard-card top-products-card">
      <div className="card-header-flex">
        <div className="chart-title-group">
          <div className="chart-icon-badge badge-award">
            <Award size={18} aria-hidden="true" />
          </div>
          <div>
            <h3 className="card-heading">Top Performing Products</h3>
            <p className="card-subheading">Highest grossing items by period revenue</p>
          </div>
        </div>

        <Link to="/products" className="card-action-link">
          <span>Inventory</span>
          <ArrowRight size={14} />
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="leaderboard-empty-state">
          <Package size={32} className="muted" />
          <p>No products sold in this period.</p>
          <small className="muted">Top revenue contributors will be ranked here.</small>
        </div>
      ) : (
        <div className="leaderboard-list">
          {products.map((product, index) => {
            const rank = RANK_BADGES[index] ?? {
              label: `#${index + 1}`,
              medal: `${index + 1}`,
              className: "rank-standard",
            };
            const revenueMinor = toMinor(product.revenue);
            const percentageOfMax = Math.round((revenueMinor / maxRevenue) * 100);

            return (
              <div key={product.product_id} className="leaderboard-row">
                <div className={`leaderboard-rank ${rank.className}`}>
                  <span className="rank-medal">{rank.medal}</span>
                </div>

                <div className="leaderboard-details">
                  <div className="leaderboard-title-line">
                    <strong className="product-title" title={product.name}>
                      {product.name}
                    </strong>
                    <span className="product-revenue">
                      {formatMoney(revenueMinor, currency)}
                    </span>
                  </div>

                  <div className="leaderboard-sub-line">
                    <span className="product-units">
                      {product.units} {product.units === 1 ? "unit" : "units"} sold
                    </span>
                  </div>

                  <div className="leaderboard-bar-track">
                    <div
                      className="leaderboard-bar-fill"
                      style={{ width: `${Math.max(6, percentageOfMax)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
