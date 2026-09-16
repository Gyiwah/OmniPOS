import { usingLaravel } from "@/src/core/api/config";
import { runSyncCycle } from "./syncEngine";
import { runLaravelSync } from "./laravelSync";
import { useSyncStore } from "@/src/store/syncStore";

/**
 * The single entry point the app calls to synchronise.
 *
 * Which backend runs is decided once, here, from build configuration — not
 * scattered through the callers. Everything upstream (the orchestrator, the
 * manual Sync button, background recovery) is unaware of the transport, so the
 * eventual removal of the Supabase path is a change to this file and a
 * deletion, not a rewrite of the app.
 *
 * Both paths consume the same local sync_queue and return the same shape.
 */

export type SyncSummary = {
  ok: boolean;
  pushed: number;
  failed: number;
  conflicts: number;
  pulled: number;
  reason?: string;
  /** Human-readable cause, surfaced to the operator when a sync does not land. */
  lastError?: string;
};

/**
 * Report the outcome so a person can see it.
 *
 * Only the Supabase engine ever wrote to this store, so on a Laravel build the
 * status stayed "idle" for ever and the home screen's error line — which is
 * conditional on it — never rendered. A till whose sync had been failing for a
 * day looked exactly like one that had nothing to send.
 *
 * Done here rather than in either transport, because this is the one place both
 * of them pass through.
 */
function report(summary: SyncSummary): SyncSummary {
  const store = useSyncStore.getState();

  if (summary.ok) {
    store.setSyncStatus("idle");
    store.setLastError(null);
    return summary;
  }

  /*
   * Genuinely having no network is not an error to shout about — a till is
   * expected to work offline, and colouring that red would train people to
   * ignore the colour. Anything else is worth someone's attention.
   */
  const merelyOffline = summary.reason === "offline";

  store.setSyncStatus(merelyOffline ? "idle" : "error");
  store.setLastError(merelyOffline ? null : (summary.lastError ?? summary.reason ?? "Sync failed"));

  return summary;
}

let inFlightSync: Promise<SyncSummary> | null = null;

export async function synchronise(storeIdHint?: string | null): Promise<SyncSummary> {
  if (inFlightSync) {
    return inFlightSync;
  }

  inFlightSync = (async () => {
    try {
      useSyncStore.getState().setSyncing(true);

      if (usingLaravel) {
        const result = await runLaravelSync(storeIdHint);
        return report({
          ok: result.ok,
          pushed: result.pushed,
          failed: 0,
          conflicts: result.conflicts,
          pulled: result.pulled,
          reason: result.reason,
          lastError: result.ok ? undefined : result.reason,
        });
      }

      const result = await runSyncCycle(storeIdHint);
      return report({
        ok: result.ok,
        pushed: result.pushed,
        failed: result.failed,
        conflicts: 0,
        pulled: 0,
        reason: (result as { reason?: string }).reason,
        lastError: (result as { lastError?: string }).lastError ?? (result as { reason?: string }).reason,
      });
    } finally {
      useSyncStore.getState().setSyncing(false);
      inFlightSync = null;
    }
  })();

  return inFlightSync;
}

export { usingLaravel };
