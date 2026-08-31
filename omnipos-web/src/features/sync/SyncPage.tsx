import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type LocalOrder, type SyncOperation } from "@/db/schema";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { getDeviceId } from "@/sync/engine";
import {
  acknowledgeOnServer,
  discardOperation,
  reissueOrder,
  retryOperation,
  type ConflictResolution,
} from "@/sync/resolve";
import { ConflictCard } from "./ConflictCard";
import { RemoteConflicts } from "./RemoteConflicts";

/**
 * Sync status and, more importantly, conflicts.
 *
 * A rejected operation is kept rather than discarded, and this is where it gets
 * settled. Silently dropping a sale the server refused would be the worst
 * behaviour available to a till: the money was taken, the customer has a
 * receipt, and the books would never know.
 */
export function SyncPage() {
  const storeId = useSession((s) => s.storeId);
  const can = useSession((s) => s.can);
  const currency = useSession((s) => s.store?.currency) ?? "GHS";
  const canResolve = can(["admin", "manager"]);

  const { online, running, pending, lastError, lastSyncedAt, sync, refreshCounts } = useSync();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (storeId) void refreshCounts(storeId);
    void getDeviceId().then(setDeviceId);
  }, [storeId, refreshCounts]);

  const queued = useLiveQuery(
    () =>
      storeId
        ? db.outbox.where("store_id").equals(storeId).toArray()
        : Promise.resolve([] as SyncOperation[]),
    [storeId],
    [] as SyncOperation[],
  );

  const localOrders = useLiveQuery(
    () =>
      storeId
        ? db.orders.where("store_id").equals(storeId).toArray()
        : Promise.resolve([] as LocalOrder[]),
    [storeId],
    [] as LocalOrder[],
  );

  const waiting = queued.filter((o) => o.status === "pending");
  const rejected = queued.filter((o) => o.status === "conflict");
  const orderById = new Map(localOrders.map((o) => [o.id, o]));

  /**
   * Settle one conflict, then push straight away so the outcome is visible
   * rather than sitting in a queue the manager has to take on trust.
   */
  const settle = useCallback(
    async (op: SyncOperation, action: ConflictResolution, run: () => Promise<string | void>) => {
      if (!storeId) return;
      setBusyId(op.operation_id);
      setNotice(null);

      try {
        const message = await run();

        // Best-effort: the local decision stands whether or not the server
        // acknowledgement lands.
        void acknowledgeOnServer(op.operation_id, action);

        if (action !== "discarded") await sync(storeId);
        await refreshCounts(storeId);

        setNotice({ kind: "ok", text: message || "Conflict settled." });
      } catch (error) {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "Could not settle that conflict.",
        });
      } finally {
        setBusyId(null);
      }
    },
    [storeId, sync, refreshCounts],
  );

  return (
    <div className="page">
      <header className="page-header">
        <h1>Synchronisation</h1>
        <button
          type="button"
          className="pay-button"
          disabled={!online || running || !storeId}
          onClick={() => storeId && void sync(storeId)}
        >
          {running ? "Syncing…" : "Sync now"}
        </button>
      </header>

      <dl className="stat-row">
        <div><dt>Connection</dt><dd>{online ? "Online" : "Offline"}</dd></div>
        <div><dt>Waiting to send</dt><dd>{pending}</dd></div>
        <div>
          <dt>Needs a decision</dt>
          <dd className={rejected.length ? "danger-text" : ""}>{rejected.length}</dd>
        </div>
        <div>
          <dt>Last synced</dt>
          <dd>{lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "Never"}</dd>
        </div>
      </dl>

      {lastError && <p className="notice notice-error">{lastError}</p>}
      {notice && <p className={`notice notice-${notice.kind}`} role="status">{notice.text}</p>}

      {rejected.length > 0 && (
        <section>
          <h2>Needs a decision</h2>
          <p className="muted">
            The server refused these. Money has already changed hands for each one, so nothing is deleted until
            somebody decides what should happen.
          </p>

          <div className="conflict-list">
            {rejected.map((op) => (
              <ConflictCard
                key={op.operation_id}
                operation={op}
                order={orderById.get(op.record_id)}
                currency={currency}
                canResolve={canResolve}
                busy={busyId === op.operation_id}
                onReissue={() =>
                  void settle(op, "reissued", async () => {
                    const { from, to } = await reissueOrder(op.operation_id);
                    return `${from} re-issued as ${to}.`;
                  })
                }
                onRetry={() =>
                  void settle(op, "retried", async () => {
                    await retryOperation(op.operation_id);
                    return "Queued to try again.";
                  })
                }
                onDiscard={() =>
                  void settle(op, "discarded", async () => {
                    await discardOperation(op.operation_id);
                    return "Discarded. The sale stays on this device but will not be booked.";
                  })
                }
              />
            ))}
          </div>
        </section>
      )}

      {canResolve && (
        <section>
          <h2>Other tills</h2>
          <p className="muted">
            Conflicts raised anywhere in this store. Settling one here uses the sale the server kept, so the till
            that rang it up does not need to be reachable.
          </p>
          <RemoteConflicts
            currency={currency}
            thisDeviceId={deviceId}
            onResolved={() => storeId && void refreshCounts(storeId)}
          />
        </section>
      )}

      <section>
        <h2>Queue</h2>
        {waiting.length === 0 ? (
          <p className="muted">Everything has reached the server.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>What</th><th>Record</th><th>Attempts</th><th>Last error</th><th>Queued</th></tr>
            </thead>
            <tbody>
              {waiting.map((o) => (
                <tr key={o.operation_id}>
                  <td>{o.entity} · {o.action}</td>
                  <td className="mono">{o.record_id.slice(0, 8)}…</td>
                  <td>{o.attempts}</td>
                  <td className="muted">{o.last_error ?? "—"}</td>
                  <td>{new Date(o.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
