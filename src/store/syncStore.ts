import { create } from "zustand";

type SyncState = {
  syncing: boolean;
  lastSyncedAt: string | null;
  setSyncing: (syncing: boolean) => void;
  markSynced: (timestamp: string) => void;
};

export const useSyncStore = create<SyncState>((set) => ({
  syncing: false,
  lastSyncedAt: null,
  setSyncing: (syncing) => set({ syncing }),
  markSynced: (timestamp) => set({ syncing: false, lastSyncedAt: timestamp }),
}));
