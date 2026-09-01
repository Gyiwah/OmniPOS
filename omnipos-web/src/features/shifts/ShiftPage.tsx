import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type LocalShift } from "@/db/schema";
import { formatMoney, toMinor } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { closeShift, openShift, recordCashMovement, shiftActivity } from "./service";
import { buildZReport } from "./shift";
import { useCurrentShift } from "./useCurrentShift";

/**
 * The cash drawer.
 *
 * A till that cannot open and close its drawer offline is not a till — the
 * morning float is counted before anyone thinks about the network, and the
 * evening count is when a shop most needs an answer it can act on. Everything
 * here writes locally and queues.
 */
export function ShiftPage() {
  const storeId = useSession((s) => s.storeId);
  const user = useSession((s) => s.user);
  const currency = useSession((s) => s.store?.currency) ?? "GHS";

  const shift = useCurrentShift();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const history = useLiveQuery(
    async () => {
      if (!storeId) return [];
      const rows = await db.shifts.where("store_id").equals(storeId).toArray();
      return rows
        .filter((s) => s.status === "closed")
        .sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""))
        .slice(0, 20);
    },
    [storeId],
    [] as LocalShift[],
  );

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (storeId) void useSync.getState().sync(storeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  if (!storeId || !user) {
    return <div className="page"><p className="muted">Select a store first.</p></div>;
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Cash drawer</h1>
        <p className="muted">{shift ? "Open" : "No drawer open on this till"}</p>
      </header>

      {error && <p className="notice notice-error" role="status">{error}</p>}

      {shift ? (
        <OpenDrawer
          shift={shift}
          storeId={storeId}
          currency={currency}
          busy={busy}
          onCashMovement={(direction, amount, reason) =>
            run(() => recordCashMovement({ storeId, shiftId: shift.id, direction, amount, reason }))
          }
          onClose={(countedCash, notes) => run(() => closeShift({ storeId, shiftId: shift.id, countedCash, notes }))}
        />
      ) : (
        <OpenDrawerForm
          currency={currency}
          busy={busy}
          onOpen={(openingFloat) =>
            run(() =>
              openShift({
                storeId,
                cashierUserId: user.id,
                cashierName: user.name,
                openingFloat,
              }),
            )
          }
        />
      )}

      {history.length > 0 && (
        <section className="drawer-history">
          <h2>Closed drawers</h2>
          <table className="table">
            <thead>
              <tr><th>Cashier</th><th>Opened</th><th>Closed</th><th>Counted</th><th>Expected</th><th>Variance</th><th /></tr>
            </thead>
            <tbody>
              {history.map((s) => {
                const counted = s.actual_cash === null ? null : toMinor(s.actual_cash);
                const expected = s.expected_cash === null ? null : toMinor(s.expected_cash);
                const variance = counted !== null && expected !== null ? counted - expected : null;

                return (
                  <tr key={s.id}>
                    <td>{s.cashier_name}</td>
                    <td>{new Date(s.opened_at).toLocaleString()}</td>
                    <td>{s.closed_at ? new Date(s.closed_at).toLocaleString() : "—"}</td>
                    <td>{counted === null ? "—" : formatMoney(counted, currency)}</td>
                    <td>{expected === null ? <span className="muted">awaiting sync</span> : formatMoney(expected, currency)}</td>
                    <td className={variance !== null && variance !== 0 ? "danger-text" : undefined}>
                      {variance === null ? "—" : formatMoney(variance, currency)}
                    </td>
                    <td>
                      {s._state === "pending" && <span className="pill pill-pending">Queued</span>}
                      {s._state === "conflict" && <span className="pill pill-offline">Needs a decision</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="conflict-hint">
            Expected cash is the server's figure, computed from every payment it has recorded against the drawer. It
            stays blank until the shift syncs, because this till only knows its own sales.
          </p>
        </section>
      )}
    </div>
  );
}

function OpenDrawerForm({
  currency,
  busy,
  onOpen,
}: {
  currency: string;
  busy: boolean;
  onOpen: (openingFloat: number) => void;
}) {
  const [float, setFloat] = useState("");

  return (
    <form
      className="drawer-card"
      onSubmit={(e) => {
        e.preventDefault();
        onOpen(toMinor(float));
      }}
    >
      <h2>Open the drawer</h2>
      <p className="muted">Count the float before the first sale. It is what every later figure is measured against.</p>

      <label htmlFor="float">Opening float ({currency})</label>
      <input
        id="float"
        inputMode="decimal"
        value={float}
        onChange={(e) => setFloat(e.target.value)}
        placeholder="0.00"
        autoFocus
      />

      <button type="submit" className="pay-button" disabled={busy}>
        {busy ? "Opening…" : "Open drawer"}
      </button>
    </form>
  );
}

function OpenDrawer({
  shift,
  storeId,
  currency,
  busy,
  onCashMovement,
  onClose,
}: {
  shift: LocalShift;
  storeId: string;
  currency: string;
  busy: boolean;
  onCashMovement: (direction: "in" | "out", amount: number, reason: string) => void;
  onClose: (countedCash: number, notes: string | null) => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [closing, setClosing] = useState(false);

  const report = useLiveQuery(
    async () => {
      const { orders, refunds } = await shiftActivity(storeId, shift.id);
      return buildZReport(shift, orders, refunds);
    },
    [storeId, shift],
    null,
  );

  const countedMinor = toMinor(counted);
  const variance = report ? countedMinor - report.drawer.expected : 0;

  return (
    <>
      <section className="drawer-grid">
        <div className="drawer-card">
          <h2>This drawer</h2>
          <dl className="cart-totals">
            <div><dt>Opened</dt><dd>{new Date(shift.opened_at).toLocaleString()}</dd></div>
            <div><dt>Cashier</dt><dd>{shift.cashier_name}</dd></div>
            <div><dt>Opening float</dt><dd>{formatMoney(toMinor(shift.opening_float), currency)}</dd></div>
            <div><dt>Cash sales</dt><dd>{report ? formatMoney(report.drawer.cashSales, currency) : "—"}</dd></div>
            <div><dt>Cash refunds</dt><dd>{report ? `−${formatMoney(report.drawer.cashRefunds, currency)}` : "—"}</dd></div>
            <div><dt>Paid in</dt><dd>{report ? formatMoney(report.drawer.paidIn, currency) : "—"}</dd></div>
            <div><dt>Paid out</dt><dd>{report ? `−${formatMoney(report.drawer.paidOut, currency)}` : "—"}</dd></div>
            <div className="cart-total">
              <dt>Expected in drawer</dt>
              <dd>{report ? formatMoney(report.drawer.expected, currency) : "—"}</dd>
            </div>
          </dl>
          {/*
            Only cash reaches the drawer. Saying so on the screen stops the
            conversation where a cashier counts the day's card takings and
            concludes the till is short by exactly that much.
          */}
          <p className="conflict-hint">
            Card, transfer and mobile money are excluded — none of it is in the box.
          </p>
        </div>

        <div className="drawer-card">
          <h2>Takings so far</h2>
          {report && (
            <>
              <dl className="cart-totals">
                <div><dt>Sales</dt><dd>{report.orderCount}</dd></div>
                <div><dt>Gross</dt><dd>{formatMoney(report.grossSales, currency)}</dd></div>
                <div><dt>Refunds</dt><dd>{report.refundCount} · −{formatMoney(report.refundTotal, currency)}</dd></div>
                <div className="cart-total"><dt>Net</dt><dd>{formatMoney(report.netSales, currency)}</dd></div>
              </dl>
              {report.byMethod.length > 0 && (
                <ul className="tender-list">
                  {report.byMethod.map((m) => (
                    <li key={m.method}>
                      <span>{m.method.replace("_", " ")}</span>
                      <span>{formatMoney(m.amount, currency)}</span>
                      <span />
                    </li>
                  ))}
                </ul>
              )}
              <p className="conflict-hint">Sales rung up on this till, against this drawer.</p>
            </>
          )}
        </div>
      </section>

      <section className="drawer-card">
        <h2>Cash in or out</h2>
        <form
          className="drawer-movement"
          onSubmit={(e) => {
            e.preventDefault();
            onCashMovement(direction, toMinor(amount), reason);
            setAmount("");
            setReason("");
          }}
        >
          <select value={direction} onChange={(e) => setDirection(e.target.value as "in" | "out")} aria-label="Direction">
            <option value="out">Paid out</option>
            <option value="in">Paid in</option>
          </select>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            aria-label="Amount"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What for? e.g. paid the bread supplier"
            aria-label="Reason"
          />
          <button type="submit" className="secondary-button" disabled={busy}>Record</button>
        </form>

        {shift.movements.length > 0 && (
          <ul className="tender-list">
            {shift.movements.map((m) => (
              <li key={m.id}>
                <span>{m.reason}</span>
                <span>{m.direction === "in" ? "" : "−"}{formatMoney(toMinor(m.amount), currency)}</span>
                <span className="muted">{new Date(m.at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="drawer-card">
        <h2>Close the drawer</h2>
        {!closing ? (
          <button type="button" className="secondary-button" onClick={() => setClosing(true)}>
            Count and close
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onClose(countedMinor, notes.trim() || null);
            }}
          >
            <label htmlFor="counted">Cash counted ({currency})</label>
            <input
              id="counted"
              inputMode="decimal"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              placeholder="0.00"
              autoFocus
            />

            {counted !== "" && report && (
              <p className={variance === 0 ? "notice notice-ok" : "notice notice-warn"}>
                {variance === 0
                  ? "Balances exactly."
                  : variance > 0
                    ? `Over by ${formatMoney(variance, currency)}.`
                    : `Short by ${formatMoney(-variance, currency)}.`}
              </p>
            )}

            <label htmlFor="drawer-notes">Notes</label>
            <input
              id="drawer-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the manager should know"
            />

            {/*
              The variance is recorded, not corrected. A till that quietly
              adjusts its expected figure to match the count cannot detect
              either theft or error, which is the only reason to count at all.
            */}
            <p className="conflict-hint">
              The difference is recorded as it stands. Nothing here changes the expected figure.
            </p>

            <div className="modal-actions">
              <button type="button" className="link" onClick={() => setClosing(false)}>Cancel</button>
              <button type="submit" className="pay-button" disabled={busy || counted === ""}>
                {busy ? "Closing…" : "Close drawer"}
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
