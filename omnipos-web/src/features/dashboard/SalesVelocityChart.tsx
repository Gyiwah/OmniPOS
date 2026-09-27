import { useState, useMemo } from "react";
import { TrendingUp, ShoppingBag, Calendar, BarChart2 } from "lucide-react";
import type { SalesReportData } from "./dashboard.types";
import { formatMoney, toMinor } from "@/features/pos/cart";

interface SalesVelocityChartProps {
  data: SalesReportData | undefined;
  isLoading: boolean;
  currency: string;
  periodLabel: string;
}

interface ChartPoint {
  dateStr: string;
  label: string;
  fullDate: string;
  revenue: number; // minor units
  orders: number;
}

export function SalesVelocityChart({
  data,
  isLoading,
  currency,
  periodLabel,
}: SalesVelocityChartProps) {
  const [metric, setMetric] = useState<"revenue" | "orders">("revenue");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Normalize series to ensure consecutive daily dates
  const points: ChartPoint[] = useMemo(() => {
    if (!data?.range) return [];

    const fromDate = new Date(data.range.from);
    const toDate = new Date(data.range.to);

    // Map existing data by YYYY-MM-DD
    const map = new Map<string, { orders: number; gross: string }>();
    for (const item of data.series ?? []) {
      map.set(item.period, { orders: item.orders, gross: item.gross });
    }

    const result: ChartPoint[] = [];
    const current = new Date(fromDate);

    // Limit loop safety (e.g. max 60 days)
    let count = 0;
    while (current <= toDate && count < 60) {
      count++;
      const dateKey = current.toISOString().slice(0, 10);
      const entry = map.get(dateKey);

      const dayName = current.toLocaleDateString(undefined, { weekday: "short" });
      const dayNum = current.getDate();
      const monthName = current.toLocaleDateString(undefined, { month: "short" });

      result.push({
        dateStr: dateKey,
        label: `${dayName} ${dayNum}`,
        fullDate: `${dayName}, ${dayNum} ${monthName}`,
        revenue: entry ? toMinor(entry.gross) : 0,
        orders: entry ? entry.orders : 0,
      });

      current.setDate(current.getDate() + 1);
    }

    return result;
  }, [data]);

  // Statistics
  const stats = useMemo(() => {
    if (points.length === 0) return { maxRev: 0, maxOrders: 0, totalRev: 0, totalOrders: 0, peakDay: null, avgRev: 0 };

    let maxRev = 0;
    let maxOrders = 0;
    let totalRev = 0;
    let totalOrders = 0;
    let peakDay: ChartPoint | null = null;

    for (const pt of points) {
      totalRev += pt.revenue;
      totalOrders += pt.orders;
      if (pt.revenue > maxRev) {
        maxRev = pt.revenue;
        peakDay = pt;
      }
      if (pt.orders > maxOrders) {
        maxOrders = pt.orders;
      }
    }

    const avgRev = Math.round(totalRev / Math.max(points.length, 1));

    return { maxRev, maxOrders, totalRev, totalOrders, peakDay, avgRev };
  }, [points]);

  // Dimensions for SVG
  const width = 640;
  const height = 220;
  const padLeft = 48;
  const padRight = 20;
  const padTop = 24;
  const padBottom = 34;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxValue = metric === "revenue" ? Math.max(stats.maxRev, 100) : Math.max(stats.maxOrders, 1);

  // Coordinate mapper
  const coords = useMemo(() => {
    if (points.length === 0) return [];

    const count = points.length;
    return points.map((pt, i) => {
      const x = count === 1 ? padLeft + chartW / 2 : padLeft + (i / (count - 1)) * chartW;
      const val = metric === "revenue" ? pt.revenue : pt.orders;
      const y = padTop + chartH - (val / maxValue) * chartH;
      return { x, y, pt };
    });
  }, [points, metric, maxValue, chartW, chartH, padLeft, padTop]);

  // SVG Paths
  const linePath = useMemo(() => {
    if (coords.length < 2) return "";
    return coords.reduce((acc, curr, i) => {
      if (i === 0) return `M ${curr.x} ${curr.y}`;
      // Smooth cubic bezier curves between points
      const prev = coords[i - 1];
      const cx = (prev.x + curr.x) / 2;
      return `${acc} C ${cx} ${prev.y}, ${cx} ${curr.y}, ${curr.x} ${curr.y}`;
    }, "");
  }, [coords]);

  const areaPath = useMemo(() => {
    if (coords.length < 2) return "";
    const first = coords[0];
    const last = coords[coords.length - 1];
    const baseLineY = padTop + chartH;
    return `${linePath} L ${last.x} ${baseLineY} L ${first.x} ${baseLineY} Z`;
  }, [linePath, coords, padTop, chartH]);

  const activePoint = hoveredIndex !== null && coords[hoveredIndex] ? coords[hoveredIndex] : null;

  return (
    <section className="dashboard-card sales-velocity-card">
      <div className="card-header-flex">
        <div className="chart-title-group">
          <div className="chart-icon-badge">
            <TrendingUp size={18} aria-hidden="true" />
          </div>
          <div>
            <h3 className="card-heading">Sales Velocity & Trajectory</h3>
            <p className="card-subheading">
              Daily revenue momentum for {periodLabel.toLowerCase()}
            </p>
          </div>
        </div>

        <div className="chart-controls">
          <div className="chart-metric-toggle" role="tablist" aria-label="Chart metric">
            <button
              type="button"
              role="tab"
              aria-selected={metric === "revenue"}
              className={`metric-toggle-btn ${metric === "revenue" ? "active" : ""}`}
              onClick={() => setMetric("revenue")}
            >
              <BarChart2 size={14} />
              <span>Revenue</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={metric === "orders"}
              className={`metric-toggle-btn ${metric === "orders" ? "active" : ""}`}
              onClick={() => setMetric("orders")}
            >
              <ShoppingBag size={14} />
              <span>Orders</span>
            </button>
          </div>
        </div>
      </div>

      {/* Highlights Strip */}
      <div className="chart-stats-strip">
        <div className="chart-stat-item">
          <span className="stat-label">Total in Period</span>
          <strong className="stat-value">
            {formatMoney(stats.totalRev, currency)}
          </strong>
          <span className="stat-hint">{stats.totalOrders} total orders</span>
        </div>
        <div className="chart-stat-item">
          <span className="stat-label">Daily Average</span>
          <strong className="stat-value">
            {formatMoney(stats.avgRev, currency)}
          </strong>
          <span className="stat-hint">Across active range</span>
        </div>
        {stats.peakDay && stats.peakDay.revenue > 0 && (
          <div className="chart-stat-item">
            <span className="stat-label">Highest Day</span>
            <strong className="stat-value">
              {formatMoney(stats.peakDay.revenue, currency)}
            </strong>
            <span className="stat-hint">{stats.peakDay.fullDate}</span>
          </div>
        )}
      </div>

      {/* SVG Canvas Area */}
      <div className="chart-svg-container">
        {isLoading ? (
          <div className="chart-loading-skeleton">
            <div className="skeleton-pulse-wave" />
            <span className="muted">Gathering daily sales telemetry…</span>
          </div>
        ) : points.length === 0 || (stats.totalRev === 0 && stats.totalOrders === 0) ? (
          <div className="chart-empty-state">
            <Calendar size={32} className="muted" />
            <p>No sales activity recorded during this period.</p>
            <small className="muted">Completed sales rung up at any till will populate this graph.</small>
          </div>
        ) : (
          <div className="svg-wrapper">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="sales-svg"
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <defs>
                <linearGradient id="salesVelocityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.38" />
                  <stop offset="60%" stopColor="var(--accent)" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>

                <filter id="glowEffect" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="var(--accent)" floodOpacity="0.3" />
                </filter>
              </defs>

              {/* Grid Lines */}
              {[0, 0.33, 0.66, 1].map((ratio) => {
                const y = padTop + chartH * (1 - ratio);
                const labelVal = metric === "revenue"
                  ? formatMoney(Math.round(maxValue * ratio), currency)
                  : String(Math.round(maxValue * ratio));
                return (
                  <g key={ratio} className="chart-grid-row">
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={width - padRight}
                      y2={y}
                      className="chart-grid-line"
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3}
                      className="chart-axis-text"
                      textAnchor="end"
                    >
                      {labelVal}
                    </text>
                  </g>
                );
              })}

              {/* Area & Stroke Paths */}
              {coords.length >= 2 && (
                <>
                  <path d={areaPath} fill="url(#salesVelocityGradient)" />
                  <path
                    d={linePath}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="2.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#glowEffect)"
                  />
                </>
              )}

              {/* Hover vertical tracking line */}
              {activePoint && (
                <line
                  x1={activePoint.x}
                  y1={padTop}
                  x2={activePoint.x}
                  y2={padTop + chartH}
                  className="chart-hover-line"
                />
              )}

              {/* Data points */}
              {coords.map((c, i) => {
                const isHovered = hoveredIndex === i;
                const hasValue = metric === "revenue" ? c.pt.revenue > 0 : c.pt.orders > 0;
                return (
                  <g key={c.pt.dateStr} className="chart-node-group">
                    {/* Invisible larger hit area for hover */}
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r="16"
                      fill="transparent"
                      className="chart-hit-target"
                      onMouseEnter={() => setHoveredIndex(i)}
                    />

                    {/* Visible outer circle */}
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r={isHovered ? 6.5 : hasValue ? 4 : 2.5}
                      className={`chart-dot ${isHovered ? "active" : ""} ${hasValue ? "has-data" : "empty"}`}
                    />

                    {/* Inner highlight */}
                    {isHovered && (
                      <circle
                        cx={c.x}
                        cy={c.y}
                        r="2.5"
                        fill="var(--accent-ink)"
                      />
                    )}

                    {/* Date label at bottom */}
                    {(points.length <= 10 || i % Math.ceil(points.length / 7) === 0 || i === points.length - 1) && (
                      <text
                        x={c.x}
                        y={height - 10}
                        className={`chart-axis-date ${isHovered ? "active-date" : ""}`}
                        textAnchor="middle"
                      >
                        {c.pt.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Floating Tooltip */}
            {activePoint && (
              <div
                className="chart-floating-tooltip"
                style={{
                  left: `${(activePoint.x / width) * 100}%`,
                  top: `${Math.max(12, (activePoint.y / height) * 100 - 24)}%`,
                }}
              >
                <div className="tooltip-header">{activePoint.pt.fullDate}</div>
                <div className="tooltip-body">
                  <div className="tooltip-row">
                    <span>Revenue:</span>
                    <strong>{formatMoney(activePoint.pt.revenue, currency)}</strong>
                  </div>
                  <div className="tooltip-row">
                    <span>Orders:</span>
                    <span>{activePoint.pt.orders} checkout{activePoint.pt.orders === 1 ? "" : "s"}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
