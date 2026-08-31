import { usingLaravel } from "@/src/core/api/config";
import { runSyncCycle } from "./syncEngine";
import { runLaravelSync } from "./laravelSync";

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

export async function synchronise(storeIdHint?: string | null): Promise<SyncSummary> {
  if (usingLaravel) {
    const result = await runLaravelSync(storeIdHint);
    return {
      ok: result.ok,
      pushed: result.pushed,
      failed: 0,
      conflicts: result.conflicts,
      pulled: result.pulled,
      reason: result.reason,
      lastError: result.ok ? undefined : result.reason,
    };
  }

  const result = await runSyncCycle(storeIdHint);
  return {
    ok: result.ok,
    pushed: result.pushed,
    failed: result.failed,
    conflicts: 0,
    pulled: 0,
    reason: (result as { reason?: string }).reason,
    lastError: (result as { lastError?: string }).lastError ?? (result as { reason?: string }).reason,
  };
}

export { usingLaravel };
