import { create } from "zustand";

type SyncStatus = "idle" | "running" | "error";

type SyncState = {
  syncing: boolean;
  lastSyncedAt: string | null;
  pendingCount: number;
  syncStatus: SyncStatus;
  lastError: string | null;
  setSyncing: (syncing: boolean) => void;
  markSynced: (timestamp: string) => void;
  setPendingCount: (n: number) => void;
  setSyncStatus: (s: SyncStatus) => void;
  setLastError: (message: string | null) => void;
};

export const useSyncStore = create<SyncState>((set) => ({
  syncing: false,
  lastSyncedAt: null,
  pendingCount: 0,
  syncStatus: "idle",
  lastError: null,
  setSyncing: (syncing) => set({ syncing }),
  markSynced: (timestamp) => set({ syncing: false, lastSyncedAt: timestamp, lastError: null }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setLastError: (lastError) => set({ lastError }),
}));
