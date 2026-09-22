import { RefreshCw, Wifi, WifiOff, AlertCircle } from "lucide-react";
import { useSync } from "@/state/sync";
import { useSession } from "@/state/session";

export function SyncStatusBadge() {
  const storeId = useSession((s) => s.storeId);
  const online = useSync((s) => s.online);
  const running = useSync((s) => s.running);
  const pending = useSync((s) => s.pending);
  const lastError = useSync((s) => s.lastError);
  const sync = useSync((s) => s.sync);

  const handleSyncClick = () => {
    if (storeId) {
      void sync(storeId);
    }
  };

  if (!online) {
    return (
      <button
        type="button"
        className="sync-badge sync-offline"
        onClick={handleSyncClick}
        title="Offline mode. Changes queued locally."
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          padding: "0.25rem 0.6rem",
          borderRadius: "999px",
          background: "#fee2e2",
          color: "#991b1b",
          fontSize: "0.75rem",
          fontWeight: 600,
          border: "1px solid #fecaca",
          cursor: "pointer",
        }}
      >
        <WifiOff size={14} />
        <span>Offline {pending > 0 ? `(${pending} queued)` : ""}</span>
      </button>
    );
  }

  if (running) {
    return (
      <div
        className="sync-badge sync-running"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          padding: "0.25rem 0.6rem",
          borderRadius: "999px",
          background: "#e0f2fe",
          color: "#0369a1",
          fontSize: "0.75rem",
          fontWeight: 600,
          border: "1px solid #bae6fd",
        }}
      >
        <RefreshCw size={14} className="spin" style={{ animation: "spin 1s linear infinite" }} />
        <span>Syncing...</span>
      </div>
    );
  }

  if (lastError) {
    return (
      <button
        type="button"
        className="sync-badge sync-error"
        onClick={handleSyncClick}
        title={`Sync error: ${lastError}. Click to retry.`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          padding: "0.25rem 0.6rem",
          borderRadius: "999px",
          background: "#fef3c7",
          color: "#92400e",
          fontSize: "0.75rem",
          fontWeight: 600,
          border: "1px solid #fde68a",
          cursor: "pointer",
        }}
      >
        <AlertCircle size={14} />
        <span>Sync Warning ({pending} queued)</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="sync-badge sync-online"
      onClick={handleSyncClick}
      title={pending > 0 ? `${pending} local changes ready to sync.` : "Synced with cloud database."}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.25rem 0.6rem",
        borderRadius: "999px",
        background: pending > 0 ? "#fef9c3" : "#dcfce7",
        color: pending > 0 ? "#854d0e" : "#166534",
        fontSize: "0.75rem",
        fontWeight: 600,
        border: pending > 0 ? "1px solid #fef08a" : "1px solid #bbf7d0",
        cursor: "pointer",
      }}
    >
      <Wifi size={14} />
      <span>{pending > 0 ? `${pending} pending` : "Synced"}</span>
    </button>
  );
}
