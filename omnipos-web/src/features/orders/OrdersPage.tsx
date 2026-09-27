import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Printer, Receipt } from "lucide-react";

import { api } from "@/api/client";
import { db, type LocalOrder } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { printTableAsPdf } from "@/utils/printTable";
import { VoidDialog } from "./VoidDialog";

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

export function OrdersPage() {
  const storeId = useSession((s) => s.storeId);
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const can = useSession((s) => s.can);

  // Voiding reverses stock and a customer's balance across the whole store, so
  // it is a manager's decision, matching the server's own policy.
  const mayVoid = can(["admin", "manager"]);
  const [voiding, setVoiding] = useState<LocalOrder | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const localOrders = useLiveQuery(
    async () => {
      if (!storeId) return [];
      const rows = await db.orders.where("store_id").equals(storeId).toArray();
      return rows.sort((a, b) => b.client_created_at.localeCompare(a.client_created_at));
    },
    [storeId],
    [] as LocalOrder[],
  );

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
  const orders = useMemo(() => {
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
        const isPartPaid = paid < total;
        if (status === "completed" && (isPartPaid || order.status === "voided")) return false;
        if (status === "part-paid" && !isPartPaid) return false;
        if (status === "voided" && order.status !== "voided") return false;
        if (status === "pending" && (!("_state" in order) || order._state !== "pending")) return false;
        if (fromDate !== null && date < fromDate) return false;
        if (toDate !== null && date > toDate) return false;
        if (!needle) return true;
        return [order.order_number, order.customer_name ?? "", order.customer_phone ?? "", createdAt ?? "", order.total]
          .some((value) => value.toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        const aDate = ("client_created_at" in a ? a.client_created_at : "") ?? "";
        const bDate = ("client_created_at" in b ? b.client_created_at : "") ?? "";
        return bDate.localeCompare(aDate);
      });
  }, [from, localOrders, remoteQuery.data, search, status, to]);

  const selectedOrder = orders.find((order) => order.id === expandedId);
  const detailQuery = useQuery({
    queryKey: ["order-detail", storeId, expandedId],
    enabled: Boolean(expandedId && selectedOrder && !localById.has(expandedId)),
    queryFn: async () => {
      const result = await api.get<{ data: OrderDetail }>(`/api/orders/${expandedId}`);
      return result.data;
    },
  });

  return (
    <div className="page">
      <header className="page-header">
        <h1><Receipt size={20} aria-hidden="true" /> Orders</h1>
        <p className="muted">All sales for this store</p>
      </header>

      <div className="page-actions" role="search">
        <button type="button" className="secondary-button" onClick={() => printTableAsPdf({
          title: "Orders & Sales",
          columns: ["Receipt", "When", "Customer", "Items", "Total", "Paid", "Status"],
          rows: orders.map((order) => {
            const outstanding = toMinor(order.total) - toMinor(order.amount_paid);
            const createdAt = "client_created_at" in order ? order.client_created_at : "";
            const orderStatus = order.status === "voided" ? "Voided" : outstanding > 0 ? "Part paid" : "Paid";
            return [
              order.order_number,
              createdAt ? new Date(createdAt).toLocaleString() : "—",
              order.customer_name ?? "Walk-in",
              String("items" in order ? order.items.length : order.items_count),
              formatMoney(toMinor(order.total), currency),
              formatMoney(toMinor(order.amount_paid), currency),
              orderStatus,
            ];
          }),
        })}>
          <Printer size={16} aria-hidden="true" /> Print / Save PDF
        </button>
        <input aria-label="Search sales" placeholder="Receipt, customer, phone, amount" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label="Filter sales by status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">All sales</option>
          <option value="completed">Paid</option>
          <option value="part-paid">Part paid</option>
          <option value="voided">Voided</option>
          <option value="pending">Awaiting sync</option>
        </select>
        <label className="muted">From <input aria-label="Sales from date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="muted">To <input aria-label="Sales to date" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>

      {remoteQuery.isError && <p className="notice notice-warn">Could not reach the server. Showing sales saved on this device.</p>}

      <div className="table-scroll">
      <table className="table">
        <thead>
          <tr><th>Sale</th><th>When</th><th>Customer</th><th>Items</th><th>Total</th><th>Paid</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const owed = toMinor(o.total) - toMinor(o.amount_paid);
            const localOrder = localById.get(o.id);
            const lines = localOrder?.items ?? (expandedId === o.id ? detailQuery.data?.items : undefined);
            const createdAt = "client_created_at" in o ? o.client_created_at : "";
            return (
              <Fragment key={o.id}>
                <tr>
                  <td>
                    <button type="button" className="link" aria-expanded={expandedId === o.id} onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}>
                      {expandedId === o.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />} <span className="mono">{o.order_number}</span>
                    </button>
                  </td>
                  <td>{createdAt ? new Date(createdAt).toLocaleString() : "—"}</td>
                  <td>{o.customer_name ?? <span className="muted">Walk-in</span>}</td>
                  <td>{"items" in o ? o.items.length : o.items_count}</td>
                  <td>{formatMoney(toMinor(o.total), currency)}</td>
                  <td className={owed > 0 ? "danger-text" : undefined}>
                    {formatMoney(toMinor(o.amount_paid), currency)}
                    {owed > 0 && <span className="muted"> ({formatMoney(owed, currency)} owed)</span>}
                  </td>
                  <td>
                    {"_state" in o && o._state === "pending" && <span className="pill pill-pending">Queued</span>}
                    {"_state" in o && o._state === "clean" && <span className="pill pill-online">Synced</span>}
                    {"_state" in o && o._state === "conflict" && <span className="pill pill-offline">Needs a decision</span>}
                    {"_state" in o && o._state === "discarded" && <span className="pill pill-discarded">Discarded</span>}
                    {o.status === "voided" && <span className="pill pill-discarded">Voided</span>}
                    {o.status !== "voided" && owed <= 0 && <span className="pill pill-online">Paid</span>}
                    {o.status !== "voided" && owed > 0 && <span className="pill pill-pending">Part paid</span>}
                  </td>
                  <td className="row-actions">
                    <Link to={`/receipt/${o.id}`}>Receipt</Link>
                    {mayVoid && localOrder && o.status !== "voided" && localOrder._state !== "discarded" && (
                      <button type="button" className="link danger" onClick={() => setVoiding(localOrder)}>Void</button>
                    )}
                  </td>
                </tr>
                {expandedId === o.id && (
                  <tr>
                    <td colSpan={8}>
                      {detailQuery.isLoading && !localOrder ? <span className="muted">Loading sale items…</span> : null}
                      {detailQuery.isError && !localOrder ? <span className="danger-text">Could not load sale items.</span> : null}
                      {lines?.length ? (
                        <div className="table-scroll">
                          <table className="table">
                            <thead><tr><th>Item</th><th>SKU</th><th>Quantity</th><th>Unit price</th><th>Line total</th></tr></thead>
                            <tbody>{lines.map((item) => <tr key={item.id}><td>{item.product_name}</td><td>{item.sku ?? "—"}</td><td>{item.quantity}</td><td>{formatMoney(toMinor(item.unit_price), currency)}</td><td>{formatMoney(toMinor(item.line_total), currency)}</td></tr>)}</tbody>
                          </table>
                        </div>
                      ) : null}
                      {lines && lines.length === 0 && <span className="muted">No item details recorded.</span>}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>

      {orders.length === 0 && <p className="muted">{remoteQuery.isLoading ? "Loading sales…" : "No sales match these filters."}</p>}

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
