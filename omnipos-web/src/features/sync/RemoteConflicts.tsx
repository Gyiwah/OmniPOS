import { useCallback, useEffect, useState } from "react";

import { api } from "@/api/client";
import { formatMoney, toMinor } from "@/features/pos/cart";

export type RemoteConflict = {
  id: number;
  operation_id: string;
  entity: string;
  record_id: string;
  reason: string;
  resolution: string;
  client_payload: Record<string, unknown> | null;
  server_state: Record<string, unknown> | null;
  device_id: string | null;
  created_at: string | null;
};

/**
 * Conflicts raised anywhere in the store, not just on this device.
 *
 * A till that hits a conflict may be offline, in a queue, or in someone else's
 * hands. The decision belongs to whoever is accountable for the books, so they
 * need to make it from wherever they are — which means the corrected data has to
 * come from the server's stored payload rather than from their own device, since
 * they never had that sale.
 */
export function RemoteConflicts({
  currency,
  thisDeviceId,
  onResolved,
}: {
  currency: string;
  thisDeviceId: string | null;
  onResolved: () => void;
}) {
  const [conflicts, setConflicts] = useState<RemoteConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: RemoteConflict[] }>("/api/sync/conflicts");
      setConflicts(res.data ?? []);
      setError(null);
    } catch {
      // Read-only view; a manager offline simply sees nothing here rather than
      // an alarming error over a screen that is otherwise working.
      setError("Conflicts across other tills need a connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (conflict: RemoteConflict, action: "reissue" | "discard") => {
      setBusyId(conflict.operation_id);
      setNotice(null);
      setError(null);

      try {
        const res = await api.post<{ booked_as: string | null }>(
          `/api/sync/conflicts/${conflict.operation_id}/resolve`,
          { action },
        );

        setNotice(
          action === "reissue"
            ? `Booked as ${res.booked_as}. The till that rang it up will pick up the new number on its next sync.`
            : "Discarded. Nothing was booked.",
        );

        await load();
        onResolved();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not settle that conflict.");
      } finally {
        setBusyId(null);
      }
    },
    [load, onResolved],
  );

  if (loading) return <p className="muted">Checking other tills…</p>;

  // Conflicts this device raised are handled in the section above, where the
  // local sale and its corrected payload are to hand.
  const fromOtherTills = conflicts.filter((c) => !thisDeviceId || c.device_id !== thisDeviceId);

  return (
    <>
      {/*
        Rendered before the empty state, not after. Settling the last conflict
        empties this list, and returning early would swallow the very message
        that says which receipt number the sale was booked under — which is what
        the manager has to relay to the cashier.
      */}
      {notice && <p className="notice notice-ok" role="status">{notice}</p>}
      {error && <p className="notice notice-error">{error}</p>}

      {fromOtherTills.length === 0 && !notice && (
        <p className="muted">{error ? error : "No conflicts on other tills."}</p>
      )}

      <div className="conflict-list">
        {fromOtherTills.map((conflict) => {
          const payload = conflict.client_payload ?? {};
          const server = conflict.server_state ?? {};

          return (
            <article key={conflict.operation_id} className="conflict-card">
              <header className="conflict-head">
                <div>
                  <h3>
                    {String(payload.order_number ?? conflict.entity)}
                    {payload.total !== undefined && (
                      <span className="conflict-amount">
                        {formatMoney(toMinor(String(payload.total)), currency)}
                      </span>
                    )}
                  </h3>
                  <p className="conflict-reason">{conflict.reason}</p>
                </div>
                <span className="pill pill-offline">Another till</span>
              </header>

              <div className="conflict-detail">
                <dl>
                  <div>
                    <dt>Rung up</dt>
                    <dd>
                      {payload.client_created_at
                        ? new Date(String(payload.client_created_at)).toLocaleString()
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Paid</dt>
                    <dd>
                      {payload.amount_paid !== undefined
                        ? formatMoney(toMinor(String(payload.amount_paid)), currency)
                        : "—"}
                    </dd>
                  </div>
                  {server.total !== undefined && (
                    <div>
                      <dt>Number already held</dt>
                      <dd>{formatMoney(toMinor(String(server.total)), currency)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Raised</dt>
                    <dd>{conflict.created_at ? new Date(conflict.created_at).toLocaleString() : "—"}</dd>
                  </div>
                </dl>
              </div>

              <footer className="conflict-actions">
                <button
                  type="button"
                  className="pay-button"
                  disabled={busyId === conflict.operation_id}
                  onClick={() => void act(conflict, "reissue")}
                >
                  Book it under a free receipt number
                </button>
                <button
                  type="button"
                  className="link danger"
                  disabled={busyId === conflict.operation_id}
                  onClick={() => void act(conflict, "discard")}
                >
                  Discard
                </button>
              </footer>

              <p className="conflict-hint">
                Booking this uses the sale the server kept when the push was rejected — the till that rang it up
                does not need to be reachable.
              </p>
            </article>
          );
        })}
      </div>
    </>
  );
}
