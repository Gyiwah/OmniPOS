import { useEffect, useState } from "react";
import {
  Printer,
  Usb,
  Bluetooth,
  AlertTriangle,
  CheckCircle2,
  FileText,
  DollarSign,
  Radio,
  Play,
  RotateCcw,
} from "lucide-react";

import { useSession } from "@/state/session";
import { buildTestPrint } from "@/features/printing/receipt";
import { anyPrintingSupport, printingSupport } from "@/features/printing/transport";
import { usePrinter } from "@/features/printing/usePrinter";

export function HardwareSettingsTab() {
  const storeName = useSession((s) => s.store?.name) ?? "OmniPOS Flagship";

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
  const [testPrinting, setTestPrinting] = useState(false);
  const support = printingSupport();

  useEffect(() => {
    void reconnect();
  }, [reconnect]);

  const runTestPrint = async () => {
    setTested(null);
    setTestPrinting(true);
    try {
      await print(buildTestPrint({ storeName, width }));
      setTested("Test print dispatched! Check the printed receipt ruler to verify width alignment.");
    } catch (e) {
      setTested(null);
    } finally {
      setTestPrinting(false);
    }
  };

  const hasDirectPrinting = anyPrintingSupport();

  return (
    <div className="settings-tab-pane">
      <div className="settings-card">
        <div className="settings-card-header">
          <div className="settings-title-group">
            <div className="settings-icon-badge badge-printer">
              <Printer size={20} aria-hidden="true" />
            </div>
            <div>
              <h2 className="settings-card-heading">Receipt Printer & Drawer</h2>
              <p className="settings-card-subheading">
                Configure direct ESC/POS thermal printing over Web Serial USB or Bluetooth
              </p>
            </div>
          </div>
          <span className="settings-pill-badge">
            <Radio size={13} /> {connection ? "Hardware Connected" : "Local Till Device"}
          </span>
        </div>

        {!hasDirectPrinting ? (
          <div className="action-alert-banner alert-warn-theme" role="status">
            <div className="alert-left-content">
              <div className="alert-icon-wrap">
                <AlertTriangle size={18} />
              </div>
              <div className="alert-text-stack">
                <strong>Direct hardware printing not supported in this browser</strong>
                <small>
                  Chrome, Edge, and Opera support direct Web Serial & Bluetooth. In Firefox or Safari, receipts will
                  automatically route through your operating system standard print dialogue.
                </small>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Connection Banner */}
            <div className={`hardware-status-banner ${connection ? "connected" : "disconnected"}`}>
              <div className="hardware-banner-left">
                <div className="hardware-pulse-wrap">
                  {connection ? (
                    <CheckCircle2 size={20} color="var(--ok)" />
                  ) : (
                    <Printer size={20} color="var(--muted)" />
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                  <strong>
                    {connection
                      ? `Connected: ${connection.label}`
                      : "No Direct Thermal Printer Paired"}
                  </strong>
                  <small>
                    {connection
                      ? `Active ESC/POS interface over ${connection.kind === "serial" ? "USB Serial" : "Bluetooth"}`
                      : "Connect a supported thermal receipt printer for instant silent printing without print dialogues"}
                  </small>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                {connection ? (
                  <button
                    type="button"
                    className="category-action-btn btn-danger"
                    onClick={() => void disconnect()}
                    title="Disconnect this printer"
                  >
                    <RotateCcw size={15} />
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {support.serial && (
                      <button
                        type="button"
                        className="settings-btn-primary"
                        style={{ padding: "0.5rem 1rem", fontSize: "0.8rem" }}
                        disabled={connecting}
                        onClick={() => void connect("serial")}
                      >
                        <Usb size={15} />
                        <span>{connecting ? "Pairing…" : "Connect USB"}</span>
                      </button>
                    )}
                    {support.bluetooth && (
                      <button
                        type="button"
                        className="settings-btn-primary"
                        style={{
                          padding: "0.5rem 1rem",
                          fontSize: "0.8rem",
                          background: "var(--panel-2)",
                          color: "var(--text-strong)",
                          boxShadow: "none",
                          border: "1px solid var(--line-strong)",
                        }}
                        disabled={connecting}
                        onClick={() => void connect("bluetooth")}
                      >
                        <Bluetooth size={15} />
                        <span>Connect Bluetooth</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {error && (
              <div className="action-alert-banner alert-danger-theme" role="status">
                <div className="alert-left-content">
                  <AlertTriangle size={18} />
                  <span>{error}</span>
                </div>
              </div>
            )}

            {/* Paper Width Visual Selector */}
            <div className="settings-field-group">
              <label className="settings-label">Receipt Paper Roll Specification</label>
              <div className="paper-selector-grid">
                <div
                  className={`paper-option-tile ${width === 80 ? "selected" : ""}`}
                  onClick={() => setWidth(80)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setWidth(80)}
                >
                  <div className="paper-option-tile-top">
                    <span className="paper-width-title">80mm Paper Roll</span>
                    <span className="paper-badge">48 Columns</span>
                  </div>
                  <p className="paper-width-desc">
                    Standard full-width commercial thermal receipt printers (e.g., Epson TM-T88, Star TSP100, Bixolon).
                  </p>
                </div>

                <div
                  className={`paper-option-tile ${width === 58 ? "selected" : ""}`}
                  onClick={() => setWidth(58)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setWidth(58)}
                >
                  <div className="paper-option-tile-top">
                    <span className="paper-width-title">58mm Paper Roll</span>
                    <span className="paper-badge">32 Columns</span>
                  </div>
                  <p className="paper-width-desc">
                    Compact portable mobile receipt printers and mini desktop terminals.
                  </p>
                </div>
              </div>
            </div>

            {/* Cash Drawer Kick Toggle */}
            <div className="switch-toggle-card">
              <div className="switch-label-block">
                <strong>
                  <DollarSign size={15} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                  Automatically Kick Cash Drawer on Cash Tender
                </strong>
                <small>
                  Sends the RJ-11/RJ-12 solenoid pulse signal to open the till drawer whenever a cash sale or refund completes.
                </small>
              </div>
              <input
                type="checkbox"
                className="toggle-switch-input"
                checked={openDrawer}
                onChange={(e) => setOpenDrawer(e.target.checked)}
                aria-label="Open cash drawer on cash sale"
              />
            </div>

            {/* Test Print Dispatch */}
            {connection && (
              <div className="settings-save-bar">
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <FileText size={16} className="muted" />
                  <small className="muted">
                    Test print prints a graduated ruler to verify your paper roll width calibration.
                  </small>
                </div>

                <button
                  type="button"
                  className="settings-btn-primary"
                  disabled={testPrinting}
                  onClick={() => void runTestPrint()}
                >
                  <Play size={14} />
                  <span>{testPrinting ? "Printing Test…" : "Send Test Print"}</span>
                </button>
              </div>
            )}

            {tested && (
              <div className="action-alert-banner alert-healthy-theme" role="status">
                <div className="alert-left-content">
                  <CheckCircle2 size={18} />
                  <span>{tested}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
