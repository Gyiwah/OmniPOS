import { useEffect, useState } from "react";
import { AlertTriangle, Bluetooth, Printer, Usb } from "lucide-react";

import { useSession } from "@/state/session";
import { buildTestPrint } from "./receipt";
import { anyPrintingSupport, printingSupport } from "./transport";
import { usePrinter } from "./usePrinter";

/**
 * Attaching a thermal printer to this till.
 *
 * Offered only where the browser can actually reach hardware. Firefox and
 * Safari have neither Web Serial nor Web Bluetooth, and showing a connect button
 * that cannot work is worse than not showing one — the browser print path stays
 * available either way, and says so here.
 */
export function PrinterSection() {
  const storeName = useSession((s) => s.store?.name) ?? "OmniPOS";

  const connection = usePrinter((s) => s.connection);
  const connecting = usePrinter((s) => s.connecting);
  const error = usePrinter((s) => s.error);
  const width = usePrinter((s) => s.width);
  const openDrawer = usePrinter((s) => s.openDrawer);
  const connect = usePrinter((s) => s.connect);
  const disconnect = usePrinter((s) => s.disconnect);
  const reconnect = usePrinter((s) => s.reconnect);
  const setWidth = usePrinter((s) => s.setWidth);
  const setOpenDrawer = usePrinter((s) => s.setOpenDrawer);
  const print = usePrinter((s) => s.print);

  const [tested, setTested] = useState<string | null>(null);
  const support = printingSupport();

  // A port already granted to this origin comes back without asking again.
  useEffect(() => void reconnect(), [reconnect]);

  const runTestPrint = async () => {
    setTested(null);
    try {
      await print(buildTestPrint({ storeName, width }));
      setTested("Sent. Check the paper — if the ruler runs off the edge, the width is wrong.");
    } catch {
      setTested(null);
    }
  };

  return (
    <section className="drawer-card">
      <h2><Printer size={18} aria-hidden="true" /> Receipt printer</h2>

      {!anyPrintingSupport() ? (
        <p className="notice notice-warn">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            This browser cannot talk to a printer directly. Chrome and Edge can. Receipts still print through the
            browser's own print dialog, which works with any printer the computer already has.
          </span>
        </p>
      ) : (
        <>
          <p className="conflict-hint">
            Connects straight to a thermal printer and sends ESC/POS, so a receipt prints on one press with no dialog.
            The browser print dialog stays available as well.
          </p>

          {connection ? (
            <p className="notice notice-ok">
              Connected to {connection.label} over {connection.kind === "serial" ? "USB" : "Bluetooth"}.
            </p>
          ) : (
            <div className="page-actions">
              {support.serial && (
                <button type="button" className="secondary-button" disabled={connecting} onClick={() => void connect("serial")}>
                  <Usb size={16} aria-hidden="true" />
                  {connecting ? "Connecting…" : "Connect over USB"}
                </button>
              )}
              {support.bluetooth && (
                <button type="button" className="secondary-button" disabled={connecting} onClick={() => void connect("bluetooth")}>
                  <Bluetooth size={16} aria-hidden="true" />
                  Connect over Bluetooth
                </button>
              )}
            </div>
          )}

          {error && (
            <p className="notice notice-error" role="status">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}

          <label htmlFor="paper-width">Paper width</label>
          <select
            id="paper-width"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value) as 58 | 80)}
          >
            <option value={80}>80mm — 48 characters</option>
            <option value={58}>58mm — 32 characters</option>
          </select>
          {/* Getting this wrong is the most common setup mistake, and it shows
              as every total being ragged rather than as an error. */}
          <p className="conflict-hint">
            The test print includes a ruler. If it runs off the edge or stops short, this is set wrong.
          </p>

          <label className="checkbox">
            <input type="checkbox" checked={openDrawer} onChange={(e) => setOpenDrawer(e.target.checked)} />
            Open the cash drawer on a cash sale
          </label>
          <p className="conflict-hint">
            Only if the drawer is wired to the printer, which is how most tills are built. Nothing else can open it.
          </p>

          {connection && (
            <div className="page-actions">
              <button type="button" className="pay-button" onClick={() => void runTestPrint()}>
                Test print
              </button>
              <button type="button" className="link danger" onClick={() => void disconnect()}>
                Forget this printer
              </button>
            </div>
          )}

          {tested && <p className="notice notice-ok" role="status">{tested}</p>}
        </>
      )}
    </section>
  );
}
