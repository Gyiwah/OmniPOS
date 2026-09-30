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
        title={`Offline mode. ${pending > 0 ? `${pending} changes queued locally.` : "Changes queued locally."}`}
        aria-label="Offline mode"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "2.1rem",
          height: "2.1rem",
          borderRadius: "50%",
          background: "#fee2e2",
          color: "#991b1b",
          border: "1px solid #fecaca",
          cursor: "pointer",
          transition: "all 0.15s ease",
          flexShrink: 0,
        }}
      >
        <WifiOff size={15} />
      </button>
    );
  }

  if (running) {
    return (
      <div
        className="sync-badge sync-running"
        title="Syncing with server…"
        aria-label="Syncing with server"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "2.1rem",
          height: "2.1rem",
          borderRadius: "50%",
          background: "#e0f2fe",
          color: "#0369a1",
          border: "1px solid #bae6fd",
          flexShrink: 0,
        }}
      >
        <RefreshCw size={15} className="spin" style={{ animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  if (lastError) {
    return (
      <button
        type="button"
        className="sync-badge sync-error"
        onClick={handleSyncClick}
        title={`Sync warning: ${lastError}. ${pending > 0 ? `${pending} queued. ` : ""}Click to retry.`}
        aria-label="Sync warning"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "2.1rem",
          height: "2.1rem",
          borderRadius: "50%",
          background: "#fef3c7",
          color: "#92400e",
          border: "1px solid #fde68a",
          cursor: "pointer",
          transition: "all 0.15s ease",
          flexShrink: 0,
        }}
      >
        <AlertCircle size={15} />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="sync-badge sync-online"
      onClick={handleSyncClick}
      title={pending > 0 ? `${pending} local changes ready to sync. Click to sync now.` : "Synced with cloud database. Click to sync."}
      aria-label={pending > 0 ? `${pending} pending changes` : "Synced with cloud database"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "2.1rem",
        height: "2.1rem",
        borderRadius: "50%",
        background: pending > 0 ? "#fef9c3" : "#dcfce7",
        color: pending > 0 ? "#854d0e" : "#166534",
        border: pending > 0 ? "1px solid #fef08a" : "1px solid #bbf7d0",
        cursor: "pointer",
        transition: "all 0.15s ease",
        flexShrink: 0,
      }}
    >
      <Wifi size={15} />
    </button>
  );
}
