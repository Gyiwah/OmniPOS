import { create } from "zustand";

type SyncStatus = "idle" | "running" | "error";

type SyncState = {
  syncing: boolean;
  lastSyncedAt: string | null;
  pendingCount: number;
  syncStatus: SyncStatus;
  setSyncing: (syncing: boolean) => void;
  markSynced: (timestamp: string) => void;
  setPendingCount: (n: number) => void;
  setSyncStatus: (s: SyncStatus) => void;
};

export const useSyncStore = create<SyncState>((set) => ({
  syncing: false,
  lastSyncedAt: null,
  pendingCount: 0,
  syncStatus: "idle",
  setSyncing: (syncing) => set({ syncing }),
  markSynced: (timestamp) => set({ syncing: false, lastSyncedAt: timestamp }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
}));
