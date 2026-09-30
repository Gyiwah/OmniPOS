import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import {
  Receipt,
  Printer,
  Search,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  DollarSign,
  Wallet,
  AlertCircle,
  CheckCircle2,
  X,
  RotateCcw,
  Sparkles,
  FileText,
  User,
  ShoppingBag,
  ExternalLink,
} from "lucide-react";

import { api } from "@/api/client";
import { db, type LocalOrder } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { printTableAsPdf } from "@/utils/printTable";
import { VoidDialog } from "./VoidDialog";

import "./orders.css";

type RemoteOrder = {
  id: string;
  order_number: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  client_created_at: string | null;
  total: string;
  amount_paid: string;
  items_count: number;
};

type OrderDetail = {
  items: Array<{
    id: string;
    product_name: string;
    sku: string | null;
    quantity: number;
    unit_price: string;
    line_total: string;
  }>;
};

type DatePreset = "all" | "today" | "yesterday" | "last7" | "thisMonth" | "custom";

export function OrdersPage() {
  const storeId = useSession((s) => s.storeId);
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const can = useSession((s) => s.can);
  const mayVoid = can(["admin", "manager"]);

  // Local state
  const [voiding, setVoiding] = useState<LocalOrder | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Live Query from local IndexedDB
  const localOrders = useLiveQuery(
    async () => {
      if (!storeId) return [];
      const rows = await db.orders.where("store_id").equals(storeId).toArray();
      return rows.sort((a, b) => b.client_created_at.localeCompare(a.client_created_at));
    },
    [storeId],
    [] as LocalOrder[]
  );

  // Remote orders query
  const remoteQuery = useQuery({
    queryKey: ["orders", storeId],
    enabled: Boolean(storeId),
    queryFn: async () => {
      const all: RemoteOrder[] = [];
      let page = 1;
      let lastPage = 1;
      do {
        const result = await api.get<{
          data: RemoteOrder[];
          meta?: { last_page?: number };
        }>("/api/orders", { per_page: 200, page });
        all.push(...(result.data ?? []));
        lastPage = result.meta?.last_page ?? page;
        page += 1;
      } while (page <= lastPage);
      return all;
    },
  });

  const localById = useMemo(() => new Map(localOrders.map((order) => [order.id, order])), [localOrders]);

  // Handle date preset change
  const handleDatePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    setCurrentPage(1);

    const now = new Date();
    const formatDate = (d: Date) => d.toISOString().split("T")[0];

    if (preset === "all") {
      setFrom("");
      setTo("");
    } else if (preset === "today") {
      const todayStr = formatDate(now);
      setFrom(todayStr);
      setTo(todayStr);
    } else if (preset === "yesterday") {
      const y = new Date();
      y.setDate(now.getDate() - 1);
      const yStr = formatDate(y);
      setFrom(yStr);
      setTo(yStr);
    } else if (preset === "last7") {
      const d7 = new Date();
      d7.setDate(now.getDate() - 7);
      setFrom(formatDate(d7));
      setTo(formatDate(now));
    } else if (preset === "thisMonth") {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      setFrom(formatDate(startOfMonth));
      setTo(formatDate(now));
    }
  };

  // Merged and filtered orders list
  const filteredOrders = useMemo(() => {
    const merged = new Map<string, RemoteOrder | LocalOrder>();
    for (const order of remoteQuery.data ?? []) merged.set(order.id, order);
    for (const order of localOrders) merged.set(order.id, order);

    const needle = search.trim().toLowerCase();
    const fromDate = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toDate = to ? new Date(`${to}T23:59:59.999`).getTime() : null;

    return [...merged.values()]
      .filter((order) => {
        const createdAt = "client_created_at" in order ? order.client_created_at : "";
        const date = new Date(createdAt || "").getTime();
        const paid = toMinor(order.amount_paid);
        const total = toMinor(order.total);
        const isPartPaid = paid < total && order.status !== "voided";

        if (status === "completed" && (isPartPaid || order.status === "voided")) return false;
        if (status === "part-paid" && !isPartPaid) return false;
        if (status === "voided" && order.status !== "voided") return false;
        if (status === "pending" && (!("_state" in order) || order._state !== "pending")) return false;
        if (fromDate !== null && date < fromDate) return false;
        if (toDate !== null && date > toDate) return false;

        if (!needle) return true;
        return [
          order.order_number,
          order.customer_name ?? "",
          order.customer_phone ?? "",
          createdAt ?? "",
          order.total,
        ].some((value) => value.toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        const aDate = ("client_created_at" in a ? a.client_created_at : "") ?? "";
        const bDate = ("client_created_at" in b ? b.client_created_at : "") ?? "";
        return bDate.localeCompare(aDate);
      });
  }, [from, localOrders, remoteQuery.data, search, status, to]);

  // Executive KPI aggregations over filtered view
  const { totalGross, totalPaid, totalDebt, voidedCount, completedCount, partPaidCount, pendingCount } =
    useMemo(() => {
      let gross = 0;
      let paid = 0;
      let debt = 0;
      let voided = 0;
      let completed = 0;
      let partPaid = 0;
      let pending = 0;

      for (const o of filteredOrders) {
        const oGross = toMinor(o.total);
        const oPaid = toMinor(o.amount_paid);
        const oOwed = oGross - oPaid;

        if (o.status === "voided") {
          voided++;
        } else {
          gross += oGross;
          paid += oPaid;
          if (oOwed > 0) {
            debt += oOwed;
            partPaid++;
          } else {
            completed++;
          }
        }

        if ("_state" in o && o._state === "pending") {
          pending++;
        }
      }

      return {
        totalGross: gross,
        totalPaid: paid,
        totalDebt: debt,
        voidedCount: voided,
        completedCount: completed,
        partPaidCount: partPaid,
        pendingCount: pending,
      };
    }, [filteredOrders]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const paginatedOrders = filteredOrders.slice(startIndex, startIndex + pageSize);

  // Expanded order details query (if not in local Dexie cache)
  const selectedOrder = filteredOrders.find((order) => order.id === expandedId);
  const detailQuery = useQuery({
    queryKey: ["order-detail", storeId, expandedId],
    enabled: Boolean(expandedId && selectedOrder && !localById.has(expandedId)),
    queryFn: async () => {
      const result = await api.get<{ data: OrderDetail }>(`/api/orders/${expandedId}`);
      return result.data;
    },
  });

  const handlePrintPdf = () => {
    printTableAsPdf({
      title: "Orders & Sales Ledger",
      columns: ["Sale #", "Date & Time", "Customer", "Items", "Total", "Paid", "Balance Owed", "Status"],
      rows: filteredOrders.map((order) => {
        const outstanding = toMinor(order.total) - toMinor(order.amount_paid);
        const createdAt = "client_created_at" in order ? order.client_created_at : "";
        const orderStatus =
          order.status === "voided"
            ? "Voided"
            : outstanding > 0
              ? "Part Paid"
              : "Paid";

        return [
          order.order_number,
          createdAt ? new Date(createdAt).toLocaleString() : "—",
          order.customer_name ?? "Walk-in Customer",
          String("items" in order ? order.items.length : order.items_count),
          formatMoney(toMinor(order.total), currency),
          formatMoney(toMinor(order.amount_paid), currency),
          outstanding > 0 ? formatMoney(outstanding, currency) : "0",
          orderStatus,
        ];
      }),
    });
  };

  const hasActiveFilters = Boolean(search || status !== "all" || from || to);

  const resetFilters = () => {
    setSearch("");
    setStatus("all");
    setDatePreset("all");
    setFrom("");
    setTo("");
    setCurrentPage(1);
  };

  return (
    <div className="orders-root">
      {/* --- Topbar Header --- */}
      <header className="orders-topbar">
        <div className="orders-title-block">
          <h1 className="orders-main-title">
            <Receipt size={26} aria-hidden="true" />
            <span>Orders & Sales Ledger</span>
          </h1>
          <div className="dashboard-clock-row">
            <span>Historical checkout transactions, audit logs, and tender breakdowns</span>
            <span>·</span>
            <span className="dashboard-currency-tag" title="Store operating currency">
              Currency: <strong>{currency}</strong>
            </span>
          </div>
        </div>

        <div className="orders-header-actions">
          <button
            type="button"
            className="dashboard-refresh-btn"
            onClick={handlePrintPdf}
            disabled={filteredOrders.length === 0}
            title="Export filtered sales to PDF or print"
          >
            <Printer size={15} />
            <span>Print / Export PDF</span>
          </button>

          <Link to="/" className="dashboard-new-sale-cta">
            <ShoppingBag size={16} />
            <span>Open POS Till</span>
          </Link>
        </div>
      </header>

      {/* --- Executive KPI Bento Grid --- */}
      <section className="orders-kpi-bento" aria-label="Sales ledger summary metrics">
        {/* 1. Total Filtered Orders */}
        <div className="orders-kpi-card">
          <div className="orders-kpi-top">
            <span className="orders-kpi-label">Sales Volume</span>
            <div className="orders-kpi-icon" style={{ background: "rgba(7, 103, 222, 0.12)", color: "#0767de" }}>
              <Receipt size={17} />
            </div>
          </div>
          <strong className="orders-kpi-val">{filteredOrders.length}</strong>
          <span className="orders-kpi-sub">
            {voidedCount > 0 ? `${filteredOrders.length - voidedCount} valid · ${voidedCount} voided` : "Valid checkout orders"}
          </span>
        </div>

        {/* 2. Gross Filtered Revenue */}
        <div className="orders-kpi-card">
          <div className="orders-kpi-top">
            <span className="orders-kpi-label">Gross Revenue</span>
            <div className="orders-kpi-icon" style={{ background: "rgba(6, 182, 212, 0.12)", color: "#06b6d4" }}>
              <DollarSign size={17} />
            </div>
          </div>
          <strong className="orders-kpi-val">{formatMoney(totalGross, currency)}</strong>
          <span className="orders-kpi-sub">Total booked value</span>
        </div>

        {/* 3. Collected Tender */}
        <div className="orders-kpi-card">
          <div className="orders-kpi-top">
            <span className="orders-kpi-label">Collected Payments</span>
            <div className="orders-kpi-icon" style={{ background: "rgba(22, 163, 74, 0.12)", color: "#16a34a" }}>
              <Wallet size={17} />
            </div>
          </div>
          <strong className="orders-kpi-val">{formatMoney(totalPaid, currency)}</strong>
          <span className="orders-kpi-sub">Settled tender received</span>
        </div>

        {/* 4. Outstanding Credit Debt */}
        <div className="orders-kpi-card">
          <div className="orders-kpi-top">
            <span className="orders-kpi-label">Outstanding Debt</span>
            <div
              className="orders-kpi-icon"
              style={{
                background: totalDebt > 0 ? "rgba(220, 38, 38, 0.12)" : "rgba(22, 163, 74, 0.12)",
                color: totalDebt > 0 ? "var(--danger)" : "var(--ok)",
              }}
            >
              {totalDebt > 0 ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}
            </div>
          </div>
          <strong
            className="orders-kpi-val"
            style={{ color: totalDebt > 0 ? "var(--danger)" : "inherit" }}
          >
            {formatMoney(totalDebt, currency)}
          </strong>
          <span className="orders-kpi-sub">
            {totalDebt > 0 ? "Customer store credit owed" : "Zero outstanding balances"}
          </span>
        </div>
      </section>

      {/* --- Filter & Search Toolbar --- */}
      <section className="orders-filter-card">
        {/* Search Row */}
        <div className="orders-search-row">
          <div className="orders-search-input-wrap">
            <Search size={16} className="orders-search-icon" />
            <input
              type="text"
              className="orders-search-input"
              placeholder="Search receipt #, customer name, phone, item SKU, total amount…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              aria-label="Search sales ledger"
            />
            {search && (
              <button
                type="button"
                className="orders-clear-search"
                onClick={() => {
                  setSearch("");
                  setCurrentPage(1);
                }}
                aria-label="Clear search query"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Date Preset Selector */}
          <div className="orders-date-filter-group">
            <select
              className="date-preset-select"
              value={datePreset}
              onChange={(e) => handleDatePresetChange(e.target.value as DatePreset)}
              aria-label="Date range preset"
            >
              <option value="all">All Dates</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last7">Last 7 Days</option>
              <option value="thisMonth">This Month</option>
              <option value="custom">Custom Date Range</option>
            </select>

            {datePreset === "custom" && (
              <div className="custom-date-inputs">
                <input
                  type="date"
                  className="custom-date-input"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setCurrentPage(1);
                  }}
                  aria-label="From date"
                />
                <span>to</span>
                <input
                  type="date"
                  className="custom-date-input"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setCurrentPage(1);
                  }}
                  aria-label="To date"
                />
              </div>
            )}

            {hasActiveFilters && (
              <button
                type="button"
                className="category-action-btn"
                style={{ width: "auto", padding: "0.35rem 0.65rem", fontSize: "0.74rem" }}
                onClick={resetFilters}
                title="Reset all filters"
              >
                <RotateCcw size={12} style={{ marginRight: 4 }} />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Filter Chips Bar */}
        <div className="orders-filter-chips-row">
          <div className="orders-status-pills" role="tablist" aria-label="Status filter">
            <button
              type="button"
              className={`status-filter-pill ${status === "all" ? "active" : ""}`}
              onClick={() => {
                setStatus("all");
                setCurrentPage(1);
              }}
            >
              <span>All Orders</span>
              <span className="pill-count">{filteredOrders.length}</span>
            </button>

            <button
              type="button"
              className={`status-filter-pill ${status === "completed" ? "active" : ""}`}
              onClick={() => {
                setStatus("completed");
                setCurrentPage(1);
              }}
            >
              <span>Paid Fully</span>
              <span className="pill-count">{completedCount}</span>
            </button>

            <button
              type="button"
              className={`status-filter-pill ${status === "part-paid" ? "active" : ""}`}
              onClick={() => {
                setStatus("part-paid");
                setCurrentPage(1);
              }}
            >
              <span>Part-Paid</span>
              <span className="pill-count">{partPaidCount}</span>
            </button>

            <button
              type="button"
              className={`status-filter-pill ${status === "pending" ? "active" : ""}`}
              onClick={() => {
                setStatus("pending");
                setCurrentPage(1);
              }}
            >
              <span>Awaiting Sync</span>
              <span className="pill-count">{pendingCount}</span>
            </button>

            <button
              type="button"
              className={`status-filter-pill ${status === "voided" ? "active" : ""}`}
              onClick={() => {
                setStatus("voided");
                setCurrentPage(1);
              }}
            >
              <span>Voided</span>
              <span className="pill-count">{voidedCount}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Offline status banner */}
      {remoteQuery.isError && (
        <div className="action-alert-banner alert-warn-theme" role="status">
          <div className="alert-left-content">
            <div className="alert-icon-wrap">
              <AlertCircle size={18} />
            </div>
            <div className="alert-text-stack">
              <strong>Offline Mode: Displaying Local Device Ledger</strong>
              <small>
                Could not connect to central server. Currently showing all orders persisted locally in this till's
                offline cache.
              </small>
            </div>
          </div>
        </div>
      )}

      {/* --- Main Orders Table Card --- */}
      <section className="orders-table-card">
        <div className="orders-table-wrapper">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Receipt #</th>
                <th>Date & Time</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Total Value</th>
                <th>Tender Paid</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedOrders.map((o) => {
                const isExpanded = expandedId === o.id;
                const owed = toMinor(o.total) - toMinor(o.amount_paid);
                const localOrder = localById.get(o.id);
                const lines = localOrder?.items ?? (isExpanded ? detailQuery.data?.items : undefined);
                const createdAt = "client_created_at" in o ? o.client_created_at : "";

                const dateObj = createdAt ? new Date(createdAt) : null;
                const dateStr = dateObj ? dateObj.toLocaleDateString() : "—";
                const timeStr = dateObj
                  ? dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : "";

                const isVoided = o.status === "voided";
                const isPartPaid = owed > 0 && !isVoided;
                const isQueued = "_state" in o && o._state === "pending";

                const customerName = o.customer_name || "Walk-in Customer";
                const customerInitials = customerName
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();

                const itemCount = "items" in o ? o.items.length : o.items_count;

                return (
                  <Fragment key={o.id}>
                    <tr
                      className={`orders-row-main ${isExpanded ? "expanded" : ""}`}
                      onClick={() => setExpandedId(isExpanded ? null : o.id)}
                    >
                      {/* 1. Receipt / Order # */}
                      <td>
                        <div className="order-num-cell">
                          <button
                            type="button"
                            className="order-chevron-btn"
                            aria-expanded={isExpanded}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(isExpanded ? null : o.id);
                            }}
                            aria-label={`Toggle details for ${o.order_number}`}
                          >
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                          <span className="order-number-tag">{o.order_number}</span>
                        </div>
                      </td>

                      {/* 2. Date & Time */}
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
                          <span style={{ fontWeight: 650, color: "var(--text-strong)" }}>{dateStr}</span>
                          <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{timeStr}</span>
                        </div>
                      </td>

                      {/* 3. Customer */}
                      <td>
                        <div className="order-customer-cell">
                          <div
                            className="customer-avatar-dot"
                            style={{
                              background: o.customer_name ? "var(--accent-soft)" : "var(--panel-2)",
                              color: o.customer_name ? "var(--accent-text)" : "var(--muted)",
                            }}
                          >
                            {o.customer_name ? customerInitials : <User size={13} />}
                          </div>
                          <div className="customer-info-stack">
                            <span className="customer-primary-name">{customerName}</span>
                            {o.customer_phone && (
                              <span className="customer-phone-sub">{o.customer_phone}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 4. Items Count */}
                      <td>
                        <span className="settings-pill-badge" style={{ fontSize: "0.72rem" }}>
                          {itemCount} item{itemCount === 1 ? "" : "s"}
                        </span>
                      </td>

                      {/* 5. Total Value */}
                      <td>
                        <strong className="order-money-val">
                          {formatMoney(toMinor(o.total), currency)}
                        </strong>
                      </td>

                      {/* 6. Tender Paid & Owed */}
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                          <span className="order-money-val" style={{ fontSize: "0.82rem" }}>
                            {formatMoney(toMinor(o.amount_paid), currency)}
                          </span>
                          {isPartPaid && (
                            <span className="order-debt-pill">
                              {formatMoney(owed, currency)} owed
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 7. Status Pill */}
                      <td>
                        {isVoided ? (
                          <span className="order-status-badge status-voided">Voided</span>
                        ) : isPartPaid ? (
                          <span className="order-status-badge status-part">Part-Paid</span>
                        ) : isQueued ? (
                          <span className="order-status-badge status-queued">Queued Sync</span>
                        ) : (
                          <span className="order-status-badge status-paid">Paid</span>
                        )}
                      </td>

                      {/* 8. Row Action Shortcuts */}
                      <td>
                        <div className="orders-row-actions" onClick={(e) => e.stopPropagation()}>
                          <Link
                            to={`/receipt/${o.id}`}
                            className="order-action-icon-btn"
                            title="View / Print Receipt"
                          >
                            <FileText size={13} />
                            <span>Receipt</span>
                          </Link>

                          {mayVoid && localOrder && !isVoided && localOrder._state !== "discarded" && (
                            <button
                              type="button"
                              className="order-action-icon-btn btn-void"
                              title="Void this sale"
                              onClick={() => setVoiding(localOrder)}
                            >
                              <RotateCcw size={13} />
                              <span>Void</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* --- Expanded Order Detail Drawer --- */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="order-detail-expanded-cell">
                          <div className="order-detail-drawer">
                            <div className="detail-drawer-header">
                              <div className="detail-header-left">
                                <ShoppingBag size={18} color="var(--accent-text)" />
                                <div>
                                  <strong style={{ fontSize: "0.95rem", color: "var(--text-strong)" }}>
                                    Line Items Breakdown for {o.order_number}
                                  </strong>
                                  <span style={{ display: "block", fontSize: "0.72rem", color: "var(--muted)" }}>
                                    {dateStr} at {timeStr} · Processed at Register Till
                                  </span>
                                </div>
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <Link to={`/receipt/${o.id}`} className="settings-btn-primary" style={{ padding: "0.4rem 0.85rem", fontSize: "0.78rem" }}>
                                  <ExternalLink size={13} />
                                  <span>Open Full Receipt</span>
                                </Link>
                              </div>
                            </div>

                            {/* Item details */}
                            {detailQuery.isLoading && !localOrder ? (
                              <p className="muted" style={{ padding: "1rem" }}>
                                Loading sale line items from server…
                              </p>
                            ) : detailQuery.isError && !localOrder ? (
                              <p className="danger-text" style={{ padding: "1rem" }}>
                                Could not load line items from server. Check your network connection.
                              </p>
                            ) : lines?.length ? (
                              <div className="orders-table-wrapper">
                                <table className="detail-items-table">
                                  <thead>
                                    <tr>
                                      <th>Product Name</th>
                                      <th>SKU Code</th>
                                      <th style={{ textAlign: "center" }}>Qty</th>
                                      <th style={{ textAlign: "right" }}>Unit Price</th>
                                      <th style={{ textAlign: "right" }}>Line Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {lines.map((item) => (
                                      <tr key={item.id}>
                                        <td style={{ fontWeight: 700, color: "var(--text-strong)" }}>
                                          {item.product_name}
                                        </td>
                                        <td style={{ fontFamily: "monospace", color: "var(--muted)" }}>
                                          {item.sku ?? "—"}
                                        </td>
                                        <td style={{ textAlign: "center", fontWeight: 700 }}>
                                          {item.quantity}
                                        </td>
                                        <td style={{ textAlign: "right" }}>
                                          {formatMoney(toMinor(item.unit_price), currency)}
                                        </td>
                                        <td style={{ textAlign: "right", fontWeight: 800, color: "var(--text-strong)" }}>
                                          {formatMoney(toMinor(item.line_total), currency)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="muted" style={{ padding: "0.5rem" }}>
                                No itemized products recorded for this transaction.
                              </p>
                            )}

                            {/* Financial totals summary strip */}
                            <div className="detail-summary-strip">
                              <div className="detail-summary-item">
                                <span>Order Total</span>
                                <strong>{formatMoney(toMinor(o.total), currency)}</strong>
                              </div>
                              <div className="detail-summary-item">
                                <span>Total Paid</span>
                                <strong style={{ color: "var(--ok)" }}>
                                  {formatMoney(toMinor(o.amount_paid), currency)}
                                </strong>
                              </div>
                              {owed > 0 && (
                                <div className="detail-summary-item">
                                  <span style={{ color: "var(--danger)" }}>Balance Due</span>
                                  <strong style={{ color: "var(--danger)" }}>
                                    {formatMoney(owed, currency)}
                                  </strong>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Empty state */}
        {filteredOrders.length === 0 && (
          <div className="chart-empty-state" style={{ padding: "3rem 1rem" }}>
            <Sparkles size={28} className="muted" />
            <strong style={{ fontSize: "1rem", color: "var(--text-strong)" }}>
              {remoteQuery.isLoading ? "Loading sales ledger…" : "No orders match your filter criteria"}
            </strong>
            <small className="muted">
              {hasActiveFilters
                ? "Try adjusting your search query, status chips, or date range."
                : "No sales have been recorded on this store yet."}
            </small>
            {hasActiveFilters && (
              <button
                type="button"
                className="empty-cta-btn"
                onClick={resetFilters}
                style={{ marginTop: "0.75rem" }}
              >
                Clear all filters
              </button>
            )}
          </div>
        )}

        {/* --- Pagination Controls Footer --- */}
        {filteredOrders.length > 0 && (
          <footer className="orders-pagination-bar">
            <span className="pagination-stats-info">
              Showing {startIndex + 1}–{Math.min(startIndex + pageSize, filteredOrders.length)} of{" "}
              {filteredOrders.length} sales
            </span>

            <div className="pagination-controls-right">
              <label className="page-size-selector">
                <span>Per page:</span>
                <select
                  className="page-size-select"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>

              <button
                type="button"
                className="pagination-nav-btn"
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={14} />
                <span>Prev</span>
              </button>

              <span style={{ fontSize: "0.78rem", fontWeight: 750, color: "var(--text-strong)", padding: "0 0.35rem" }}>
                {safeCurrentPage} / {totalPages}
              </span>

              <button
                type="button"
                className="pagination-nav-btn"
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                <span>Next</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </footer>
        )}
      </section>

      {/* --- Void Confirmation Dialog --- */}
      {voiding && (
        <VoidDialog
          order={voiding}
          currency={currency}
          onClose={() => setVoiding(null)}
          onVoided={() => {
            setVoiding(null);
            if (storeId) void useSync.getState().sync(storeId);
          }}
        />
      )}
    </div>
  );
}
