import { create } from "zustand";

import { conflicts, pendingCount, runSync } from "@/sync/engine";
import type { SyncOperation } from "@/db/schema";

type SyncState = {
  online: boolean;
  running: boolean;
  pending: number;
  conflicts: SyncOperation[];
  lastError: string | null;
  lastSyncedAt: string | null;

  refreshCounts: (storeId: string) => Promise<void>;
  sync: (storeId: string) => Promise<void>;
  setOnline: (online: boolean) => void;
};

export const useSync = create<SyncState>((set, get) => ({
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  running: false,
  pending: 0,
  conflicts: [],
  lastError: null,
  lastSyncedAt: null,

  setOnline: (online) => set({ online }),

  async refreshCounts(storeId) {
    set({ pending: await pendingCount(storeId), conflicts: await conflicts(storeId) });
  },

  async sync(storeId) {
    // Overlapping cycles would push the same outbox rows twice. The server
    // deduplicates on operation_id so it would be harmless, but it wastes a
    // round trip and muddles the counters.
    if (get().running) return;

    set({ running: true, lastError: null });

    try {
      const result = await runSync(storeId);
      if (result.ok) set({ lastSyncedAt: new Date().toISOString() });
      else if (result.reason !== "offline") set({ lastError: result.reason ?? null });
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : "Sync failed" });
    } finally {
      set({ running: false });
      await get().refreshCounts(storeId);
    }
  },
}));

/**
 * Sync when the connection returns, when the tab is refocused, and on a slow
 * timer as a backstop.
 *
 * The timer is deliberately unhurried: the outbox is durable, so a delay costs
 * nothing but a request that fails while offline costs a wasted wake-up on a
 * device that may be on a phone hotspot.
 */
export function startSyncScheduler(getStoreId: () => string | null): () => void {
  const trigger = () => {
    const storeId = getStoreId();
    if (storeId && navigator.onLine) void useSync.getState().sync(storeId);
  };

  const onOnline = () => {
    useSync.getState().setOnline(true);
    trigger();
  };
  const onOffline = () => useSync.getState().setOnline(false);
  const onVisible = () => {
    if (document.visibilityState === "visible") trigger();
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);

  const timer = window.setInterval(trigger, 60_000);
  trigger();

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}
