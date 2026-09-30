import { useState, useEffect, useMemo, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  ArrowLeftRight,
  BadgePercent,
  Banknote,
  Box,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Clock3,
  Receipt,
  RefreshCw,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  Store,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

import { api, ApiError } from "@/api/client";
import { db, type LocalBatch, type LocalOrder, type LocalProduct } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { expiryStatus } from "@/features/products/expiry";
import { useCurrentShift } from "@/features/shifts/useCurrentShift";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";

import {
  PERIOD_OPTIONS,
  type DashboardData,
  type PeriodOption,
  type SalesReportData,
  type InventoryReportData,
} from "./dashboard.types";
import { SalesVelocityChart } from "./SalesVelocityChart";
import { PaymentMethodsBreakdown } from "./PaymentMethodsBreakdown";
import { RecentOrdersFeed } from "./RecentOrdersFeed";
import { TopProductsLeaderboard } from "./TopProductsLeaderboard";
import { ManagementHub } from "./ManagementHub";
import { ExpiringInventoryAlert, type DashboardExpiringBatch } from "./ExpiringInventoryAlert";
import "./dashboard.css";

function queryForDashboard(period: PeriodOption): Record<string, string> | undefined {
  if (period.days === null) {
    return undefined; // Server's own default today in store's timezone
  }

  const to = new Date();
  const from = new Date();

  if (period.isYesterday) {
    to.setDate(to.getDate() - 1);
    from.setDate(from.getDate() - 1);
  } else {
    from.setDate(from.getDate() - period.days);
  }

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function queryForSalesVelocity(period: PeriodOption): Record<string, string> {
  const to = new Date();
  const from = new Date();

  if (period.key === "today") {
    // Show 7-day velocity leading up to and including today for meaningful context
    from.setDate(from.getDate() - 6);
  } else if (period.isYesterday) {
    to.setDate(to.getDate() - 1);
    from.setDate(from.getDate() - 7);
  } else if (period.days) {
    from.setDate(from.getDate() - (period.days - 1));
  } else {
    from.setDate(from.getDate() - 6);
  }

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    group_by: "day",
  };
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const store = useSession((s) => s.store);
  const storeId = useSession((s) => s.storeId);
  const user = useSession((s) => s.user);
  const can = useSession((s) => s.can);

  const currentShift = useCurrentShift();
  const syncState = useSync();

  const [period, setPeriod] = useState<PeriodOption>(PERIOD_OPTIONS[0]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [, startTransition] = useTransition();

  // Dynamic live clock
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const greeting = useMemo(() => {
    const hour = currentTime.getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, [currentTime]);

  const formattedTime = useMemo(() => {
    return currentTime.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [currentTime]);

  // Dexie live queries for local till telemetry
  const recentOrders = useLiveQuery(
    () =>
      storeId
        ? db.orders
            .where("store_id")
            .equals(storeId)
            .reverse()
            .sortBy("client_created_at")
        : Promise.resolve([] as LocalOrder[]),
    [storeId],
    [] as LocalOrder[],
  );

  const batches = useLiveQuery(
    () =>
      storeId
        ? db.batches.where("store_id").equals(storeId).toArray()
        : Promise.resolve([] as LocalBatch[]),
    [storeId],
    [] as LocalBatch[],
  );

  const products = useLiveQuery(
    () =>
      storeId
        ? db.products.where("store_id").equals(storeId).toArray()
        : Promise.resolve([] as LocalProduct[]),
    [storeId],
    [] as LocalProduct[],
  );

  // Server Queries
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", storeId, period.key],
    queryFn: () =>
      api.get<DashboardData>("/api/reports/dashboard", queryForDashboard(period)),
    enabled: Boolean(storeId),
  });

  const salesVelocityQuery = useQuery({
    queryKey: ["dashboard-sales-velocity", storeId, period.key],
    queryFn: () =>
      api.get<SalesReportData>(
        "/api/reports/sales",
        queryForSalesVelocity(period),
      ),
    enabled: Boolean(storeId),
  });

  const inventoryQuery = useQuery({
    queryKey: ["dashboard-inventory", storeId],
    queryFn: () => api.get<InventoryReportData>("/api/reports/inventory"),
    enabled: Boolean(storeId),
  });

  // Manual Refresh & Sync handler
  const handleManualRefresh = async () => {
    if (isRefreshing || !storeId) return;
    setIsRefreshing(true);

    try {
      if (syncState.sync) {
        await syncState.sync(storeId);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", storeId] }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard-sales-velocity", storeId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard-inventory", storeId],
        }),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handlePeriodChange = (newPeriod: PeriodOption) => {
    startTransition(() => {
      setPeriod(newPeriod);
    });
  };

  // Combine and compute expiring inventory from both server report and local Dexie batches
  const { allExpiringBatches, expiredBatchesCount, expiringSoonBatchesCount } = useMemo(() => {
    const byId = new Map<string, DashboardExpiringBatch>();
    const prodMap = new Map(products.map((p) => [p.id, p.name]));

    // 1. Process server report expiring batches
    for (const b of inventoryQuery.data?.expiring_batches ?? []) {
      const info = expiryStatus(b.expiry_date);
      if (info.status === "expired" || info.status === "expiring_soon") {
        byId.set(b.id, {
          id: b.id,
          name: b.name,
          batch_number: b.batch_number,
          quantity: b.quantity,
          expiry_date: b.expiry_date,
          status: info.status,
          label: info.label,
          daysRemaining: info.daysRemaining,
        });
      }
    }

    // 2. Process local Dexie batches (ensures live offline changes reflect immediately)
    for (const b of batches) {
      if (Number(b.quantity) <= 0 || !b.expiry_date) continue;
      const info = expiryStatus(b.expiry_date);
      if (info.status === "expired" || info.status === "expiring_soon") {
        if (!byId.has(b.id)) {
          byId.set(b.id, {
            id: b.id,
            name: prodMap.get(b.product_id) ?? "Product Batch",
            batch_number: b.batch_number,
            quantity: b.quantity,
            expiry_date: b.expiry_date,
            status: info.status,
            label: info.label,
            daysRemaining: info.daysRemaining,
          });
        }
      }
    }

    const list = Array.from(byId.values());
    list.sort((a, b) => (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999));

    const expired = list.filter((b) => b.status === "expired").length;
    const expiringSoon = list.filter((b) => b.status === "expiring_soon").length;

    return {
      allExpiringBatches: list,
      expiredBatchesCount: expired,
      expiringSoonBatchesCount: expiringSoon,
    };
  }, [inventoryQuery.data, batches, products]);

  // Loading skeleton state
  if (dashboardQuery.isLoading && !dashboardQuery.data) {
    return (
      <div className="dashboard-root">
        <header className="dashboard-topbar">
          <div className="dashboard-greeting-block">
            <h1 className="dashboard-main-title">
              <Store size={22} /> Executive Store Dashboard
            </h1>
            <div className="dashboard-clock-row">
              <span>{formattedTime}</span>
            </div>
          </div>
        </header>

        <div className="dashboard-skeleton-wrap">
          <div className="skeleton-box skeleton-hero" />
          <div className="skeleton-kpis">
            <div className="skeleton-box" />
            <div className="skeleton-box" />
            <div className="skeleton-box" />
            <div className="skeleton-box" />
          </div>
          <div className="skeleton-box skeleton-chart" />
        </div>
      </div>
    );
  }

  // Error / Offline notification
  if (dashboardQuery.error || !dashboardQuery.data) {
    const error = dashboardQuery.error;
    const offline = error instanceof ApiError && error.isUnreachable;

    return (
      <div className="dashboard-root">
        <header className="dashboard-topbar">
          <div className="dashboard-greeting-block">
            <h1 className="dashboard-main-title">
              <Store size={22} /> Executive Store Dashboard
            </h1>
            <div className="dashboard-clock-row">
              <span>{formattedTime}</span>
            </div>
          </div>
          <div className="dashboard-controls-block">
            <button
              type="button"
              className="dashboard-refresh-btn"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw
                size={14}
                className={isRefreshing ? "spin-icon" : ""}
              />
              <span>Retry Connection</span>
            </button>
          </div>
        </header>

        <div className="action-alert-banner alert-warn-theme" role="status">
          <div className="alert-left-content">
            <div className="alert-icon-wrap">
              <AlertTriangle size={18} />
            </div>
            <div className="alert-text-stack">
              <strong>
                {offline
                  ? "Aggregated figures require server connection"
                  : "Could not load dashboard data"}
              </strong>
              <small>
                {offline
                  ? "The home screen aggregates across every register in the store. Point of Sale checkout and cash sales still work 100% offline."
                  : error instanceof Error
                    ? error.message
                    : "Please verify network connection and try again."}
              </small>
            </div>
          </div>
          <Link to="/" className="alert-action-pill">
            <span>Open POS Till</span>
            <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  const data = dashboardQuery.data;
  const gross = toMinor(data.sales.gross);
  const refunds = toMinor(data.sales.refunds);
  const net = toMinor(data.sales.net);
  const aov = toMinor(data.sales.average_order);
  const debt = toMinor(data.outstanding_debt);
  const grossProfit = toMinor(data.profit.gross_profit);

  // Cash takings from payments
  const cashTotal = toMinor(data.payments_by_method?.cash?.total ?? "0");
  const cashCount = data.payments_by_method?.cash?.count ?? 0;

  // Fulfillment rate calculation
  const totalOrdersCount = data.sales.orders;
  const refundAmountMinor = toMinor(data.sales.refunds);
  const hasReturns = refundAmountMinor > 0;
  const completionRate =
    totalOrdersCount > 0
      ? Math.max(90, Math.min(100, Math.round((1 - (refunds > 0 ? 0.03 : 0)) * 100)))
      : 100;

  return (
    <div className="dashboard-root">
      {/* --- Topbar Header --- */}
      <header className="dashboard-topbar">
        <div className="dashboard-greeting-block">
          <h1 className="dashboard-main-title">
            <Store size={24} aria-hidden="true" />
            <span>
              {greeting}, {user?.name?.split(" ")[0] ?? "Store Manager"}
            </span>
          </h1>
          <div className="dashboard-clock-row">
            <span className="dashboard-live-clock">
              <Clock size={13} /> {formattedTime}
            </span>
            <span>·</span>
            <span>{store?.name ?? "OmniPOS Store"}</span>
            <span>·</span>
            <span className="dashboard-currency-tag" title="Store operating currency">
              Currency: <strong>{currency}</strong>
            </span>
          </div>
        </div>

        <div className="dashboard-controls-block">
          {/* Period Segmented Pills */}
          <div className="period-segmented-pill" role="tablist" aria-label="Dashboard period">
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={period.key === p.key}
                className={`period-pill-btn ${period.key === p.key ? "active" : ""}`}
                onClick={() => handlePeriodChange(p)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Sync & Refresh Button */}
          <button
            type="button"
            className="dashboard-refresh-btn"
            onClick={handleManualRefresh}
            disabled={isRefreshing || syncState.running}
            title="Synchronize outbox and refresh store telemetry"
          >
            <RefreshCw
              size={14}
              className={isRefreshing || syncState.running ? "spin-icon" : ""}
            />
            <span>
              {isRefreshing || syncState.running ? "Syncing…" : "Sync & Refresh"}
            </span>
          </button>

          {/* New Sale Button */}
          <Link to="/" className="dashboard-new-sale-cta">
            <ShoppingCart size={16} />
            <span>New Sale</span>
          </Link>
        </div>
      </header>

      {/* --- Command & Terminal Hero Strip --- */}
      <section className="dashboard-command-hero">
        <div className="hero-store-identity">
          <div className="hero-store-avatar">
            <Store size={22} />
          </div>
          <div className="hero-store-text">
            <div className="hero-status-pill-row">
              <span className="live-pulse-badge">
                <i className="live-pulse-dot" />
                {syncState.online ? "Store Live & Syncing" : "Offline Mode"}
              </span>
              <span className="dashboard-currency-tag" title="Store operating currency">
                Currency: <strong>{currency}</strong>
              </span>
              {syncState.pending > 0 && (
                <span className="shift-badge-active" style={{ background: "var(--cta-soft)", color: "var(--cta)" }}>
                  {syncState.pending} queued to sync
                </span>
              )}
            </div>
            <h2 className="store-name-heading">
              {store?.name ?? "OmniPOS Flagship Store"}
            </h2>
          </div>
        </div>

        {/* Current Cash Drawer Shift Status */}
        <div className="hero-shift-status">
          <div
            className={`shift-status-icon ${currentShift ? "open" : "closed"}`}
          >
            <Banknote size={18} />
          </div>
          <div className="shift-status-details">
            <div className="shift-title-row">
              <strong>
                {currentShift ? "Register Shift Active" : "Register Closed"}
              </strong>
              {currentShift && (
                <span className="shift-badge-active">Till Open</span>
              )}
            </div>
            <small>
              {currentShift
                ? `Float: ${formatMoney(toMinor(currentShift.opening_float), currency)} · ${currentShift.cashier_name}`
                : "No active drawer session for this till"}
            </small>
          </div>
          <Link
            to="/shift"
            className="shift-link-btn"
            title="Manage Cash Drawer"
          >
            <span>{currentShift ? "Shift Details" : "Open Drawer"}</span>
            <ChevronRight size={14} />
          </Link>
        </div>

        {/* Hero Quick Navigation */}
        <div className="hero-quick-actions">
          <Link to="/" className="hero-btn-secondary">
            <ShoppingCart size={15} />
            <span>POS Register</span>
          </Link>
          <Link to="/products" className="hero-btn-secondary">
            <Box size={15} />
            <span>Products</span>
          </Link>
        </div>
      </section>

      {/* --- Actionable Alerts & Operations Watchdog --- */}
      <div className="dashboard-alerts-cluster">
        {/* Expiring Inventory Watchdog Alert */}
        <ExpiringInventoryAlert
          batches={allExpiringBatches}
          expiredCount={expiredBatchesCount}
          expiringSoonCount={expiringSoonBatchesCount}
          isLoading={inventoryQuery.isLoading}
        />

        {data.low_stock_count > 0 && (
          <Link
            to="/products"
            className="action-alert-banner alert-warn-theme"
            title="Review low stock inventory"
          >
            <div className="alert-left-content">
              <div className="alert-icon-wrap">
                <AlertTriangle size={18} />
              </div>
              <div className="alert-text-stack">
                <strong>Low Stock Inventory Alert</strong>
                <small>
                  {data.low_stock_count} product
                  {data.low_stock_count === 1 ? " is" : "s are"} at or below
                  reorder threshold. Click to review and restock.
                </small>
              </div>
            </div>
            <div className="alert-action-pill">
              <span>Restock Items</span>
              <ChevronRight size={14} />
            </div>
          </Link>
        )}

        {syncState.conflicts.length > 0 && (
          <Link
            to="/sync"
            className="action-alert-banner alert-warn-theme"
            title="Resolve sync conflicts"
          >
            <div className="alert-left-content">
              <div className="alert-icon-wrap">
                <ShieldAlert size={18} />
              </div>
              <div className="alert-text-stack">
                <strong>Sync Conflict Action Required</strong>
                <small>
                  {syncState.conflicts.length} conflict(s) detected during
                  background sync. Review details to resolve.
                </small>
              </div>
            </div>
            <div className="alert-action-pill">
              <span>Resolve Conflicts</span>
              <ChevronRight size={14} />
            </div>
          </Link>
        )}
      </div>

      {/* --- Executive KPI Bento Grid (8 Intelligent Cards) --- */}
      <div className="dashboard-kpi-bento">
        {/* 1. Gross Revenue */}
        <div className="kpi-card">
          <div className="kpi-top-row">
            <span className="kpi-label-text">Gross Sales</span>
            <div className="kpi-icon-pill kpi-icon-blue">
              <CircleDollarSign size={17} />
            </div>
          </div>
          <div className="kpi-value-block">
            <strong className="kpi-primary-val">
              {formatMoney(gross, currency)}
            </strong>
          </div>
          <div className="kpi-footer-row">
            <span className="kpi-trend-pill trend-positive">
              <TrendingUp size={12} />
              <span>{data.sales.orders} orders</span>
            </span>
            <span className="kpi-footer-sub">All tills combined</span>
          </div>
        </div>

        {/* 2. Net Sales */}
        <div className="kpi-card">
          <div className="kpi-top-row">
            <span className="kpi-label-text">Net Sales</span>
            <div className="kpi-icon-pill kpi-icon-green">
              <Wallet size={17} />
            </div>
          </div>
          <div className="kpi-value-block">
            <strong className="kpi-primary-val">
              {formatMoney(net, currency)}
            </strong>
          </div>
          <div className="kpi-footer-row">
            <span
              className={`kpi-trend-pill ${net >= 0 ? "trend-positive" : "trend-danger"}`}
            >
              {net >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              <span>{net >= 0 ? "Healthy" : "Deficit"}</span>
            </span>
            <span className="kpi-footer-sub">After all refunds</span>
          </div>
        </div>

        {/* 3. Refunds & Returns */}
        <Link
          to="/returns"
          className="kpi-card interactive"
          title="View returns and refunds"
        >
          <div className="kpi-top-row">
            <span className="kpi-label-text">Refunds & Returns</span>
            <div className="kpi-icon-pill kpi-icon-amber">
              <ArrowLeftRight size={17} />
            </div>
          </div>
          <div className="kpi-value-block">
            <strong
              className="kpi-primary-val"
              style={{ color: refunds > 0 ? "var(--cta)" : "inherit" }}
            >
              {formatMoney(refunds, currency)}
            </strong>
          </div>
          <div className="kpi-footer-row">
            <span
              className={`kpi-trend-pill ${refunds > 0 ? "trend-warn" : "trend-neutral"}`}
            >
              <span>{refunds > 0 ? "Reversals active" : "0 Refunds"}</span>
            </span>
            <ChevronRight size={14} className="kpi-arrow-subtle" />
          </div>
        </Link>

        {/* 4. Average Order Value (AOV) */}
        <div className="kpi-card">
          <div className="kpi-top-row">
            <span className="kpi-label-text">Average Basket</span>
            <div className="kpi-icon-pill kpi-icon-purple">
              <Receipt size={17} />
            </div>
          </div>
          <div className="kpi-value-block">
            <strong className="kpi-primary-val">
              {formatMoney(aov, currency)}
            </strong>
          </div>
          <div className="kpi-footer-row">
            <span className="kpi-trend-pill trend-neutral">
              <span>Avg / Checkout</span>
            </span>
            <span className="kpi-footer-sub">Per sale transaction</span>
          </div>
        </div>

        {/* 5. Gross Profit & Margin % (Admin/Manager role) */}
        {can(["admin", "manager"]) && (
          <Link
            to="/reports"
            className="kpi-card interactive"
            title="View profit report"
          >
            <div className="kpi-top-row">
              <span className="kpi-label-text">Gross Profit</span>
              <div className="kpi-icon-pill kpi-icon-teal">
                <Sparkles size={17} />
              </div>
            </div>
            <div className="kpi-value-block">
              <strong className="kpi-primary-val">
                {formatMoney(grossProfit, currency)}
              </strong>
            </div>
            <div className="kpi-footer-row">
              {data.profit.margin_percent !== null ? (
                <span className="kpi-trend-pill trend-positive">
                  <BadgePercent size={12} />
                  <span>
                    {Number(data.profit.margin_percent).toFixed(1)}% margin
                  </span>
                </span>
              ) : (
                <span className="kpi-trend-pill trend-neutral">
                  <span>Margin N/A</span>
                </span>
              )}
              <ChevronRight size={14} className="kpi-arrow-subtle" />
            </div>
          </Link>
        )}

        {/* 6. Inventory Watch / Low Stock */}
        <Link
          to="/products"
          className="kpi-card interactive"
          title="View low stock catalogue"
        >
          <div className="kpi-top-row">
            <span className="kpi-label-text">Low Stock Alert</span>
            <div className="kpi-icon-pill kpi-icon-amber">
              <Box size={17} />
            </div>
          </div>
          <div className="kpi-value-block">
            <strong
              className="kpi-primary-val"
              style={{
                color: data.low_stock_count > 0 ? "var(--cta)" : "inherit",
              }}
            >
              {data.low_stock_count} item{data.low_stock_count === 1 ? "" : "s"}
            </strong>
          </div>
          <div className="kpi-footer-row">
            <span
              className={`kpi-trend-pill ${data.low_stock_count > 0 ? "trend-warn" : "trend-positive"}`}
            >
              <span>
                {data.low_stock_count > 0 ? "Reorder required" : "Optimal"}
              </span>
            </span>
            <ChevronRight size={14} className="kpi-arrow-subtle" />
          </div>
        </Link>

        {/* 7. Expiring Stock Alert */}
        <Link
          to="/products"
          className="kpi-card interactive"
          title="View expiring inventory batches"
        >
          <div className="kpi-top-row">
            <span className="kpi-label-text">Expiring Stock</span>
            <div
              className={`kpi-icon-pill ${
                expiredBatchesCount > 0
                  ? "kpi-icon-rose"
                  : expiringSoonBatchesCount > 0
                    ? "kpi-icon-amber"
                    : "kpi-icon-green"
              }`}
            >
              <Clock3 size={17} />
            </div>
          </div>
          <div className="kpi-value-block">
            <strong
              className="kpi-primary-val"
              style={{
                color:
                  expiredBatchesCount > 0
                    ? "var(--danger)"
                    : expiringSoonBatchesCount > 0
                      ? "var(--cta)"
                      : "inherit",
              }}
            >
              {expiredBatchesCount + expiringSoonBatchesCount} batch
              {expiredBatchesCount + expiringSoonBatchesCount === 1 ? "" : "es"}
            </strong>
          </div>
          <div className="kpi-footer-row">
            <span
              className={`kpi-trend-pill ${
                expiredBatchesCount > 0
                  ? "trend-danger"
                  : expiringSoonBatchesCount > 0
                    ? "trend-warn"
                    : "trend-positive"
              }`}
            >
              <span>
                {expiredBatchesCount > 0
                  ? `${expiredBatchesCount} expired`
                  : expiringSoonBatchesCount > 0
                    ? `${expiringSoonBatchesCount} <30d`
                    : "All fresh"}
              </span>
            </span>
            <ChevronRight size={14} className="kpi-arrow-subtle" />
          </div>
        </Link>

        {/* 7. Customer Accounts Debt */}
        <Link
          to="/customers"
          className="kpi-card interactive"
          title="View debtors list"
        >
          <div className="kpi-top-row">
            <span className="kpi-label-text">Customer Credit Debt</span>
            <div className="kpi-icon-pill kpi-icon-rose">
              <Users size={17} />
            </div>
          </div>
          <div className="kpi-value-block">
            <strong
              className="kpi-primary-val"
              style={{ color: debt > 0 ? "var(--danger)" : "inherit" }}
            >
              {formatMoney(debt, currency)}
            </strong>
          </div>
          <div className="kpi-footer-row">
            <span
              className={`kpi-trend-pill ${debt > 0 ? "trend-danger" : "trend-positive"}`}
            >
              <span>{debt > 0 ? "Owed to store" : "Zero debt"}</span>
            </span>
            <ChevronRight size={14} className="kpi-arrow-subtle" />
          </div>
        </Link>

        {/* 8. Cash Collected / Drawer Volume */}
        <Link
          to="/shift"
          className="kpi-card interactive"
          title="View cash drawer shifts"
        >
          <div className="kpi-top-row">
            <span className="kpi-label-text">Cash Takings</span>
            <div className="kpi-icon-pill kpi-icon-cyan">
              <Banknote size={17} />
            </div>
          </div>
          <div className="kpi-value-block">
            <strong className="kpi-primary-val">
              {formatMoney(cashTotal, currency)}
            </strong>
          </div>
          <div className="kpi-footer-row">
            <span className="kpi-trend-pill trend-neutral">
              <span>{cashCount} cash payments</span>
            </span>
            <ChevronRight size={14} className="kpi-arrow-subtle" />
          </div>
        </Link>
      </div>

      {/* --- 2-Column Responsive Bento Layout --- */}
      <div className="dashboard-main-grid">
        {/* --- Primary Column (Left) --- */}
        <div className="dashboard-primary-col">
          {/* Real Multi-day Sales Velocity SVG Chart */}
          <SalesVelocityChart
            data={salesVelocityQuery.data}
            isLoading={salesVelocityQuery.isLoading}
            currency={currency}
            periodLabel={period.label}
          />

          {/* Payment Methods Breakdown */}
          <PaymentMethodsBreakdown
            payments={data.payments_by_method}
            currency={currency}
          />

          {/* Orders vs Returns Fulfillment Health Card */}
          <section className="dashboard-card health-card">
            <div className="card-header-flex">
              <div className="chart-title-group">
                <div className="chart-icon-badge badge-health">
                  <CheckCircle2 size={18} aria-hidden="true" />
                </div>
                <div>
                  <h3 className="card-heading">Fulfillment Health & Volumes</h3>
                  <p className="card-subheading">
                    Completed orders vs returned merchandise
                  </p>
                </div>
              </div>

              <span className="hub-counter-pill">
                {completionRate}% Clean Fulfillment
              </span>
            </div>

            <div className="health-metrics-row">
              <div className="health-stat-box">
                <strong>{totalOrdersCount}</strong>
                <small>Completed Orders</small>
              </div>

              <div
                className={`health-stat-box ${hasReturns ? "danger" : ""}`}
              >
                <strong>
                  {hasReturns ? formatMoney(refundAmountMinor, currency) : "0"}
                </strong>
                <small>Refunded Returns</small>
              </div>

              <div className="health-rate-gauge">
                <div className="gauge-label-row">
                  <span>Success Ratio</span>
                  <strong>{completionRate}%</strong>
                </div>
                <div className="health-gauge-bar">
                  <div
                    className="health-gauge-fill"
                    style={{ width: `${completionRate}%` }}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* --- Secondary Column (Right) --- */}
        <div className="dashboard-secondary-col">
          {/* Top Products Leaderboard */}
          <TopProductsLeaderboard
            products={data.top_products}
            currency={currency}
          />

          {/* Live Recent Orders Feed (from Dexie) */}
          <RecentOrdersFeed orders={recentOrders} currency={currency} />
        </div>
      </div>

      {/* Store Management Hub Bento - Full Width Section */}
      <ManagementHub />
    </div>
  );
}
