import { useFocusEffect } from "@react-navigation/native";
import { useCallback } from "react";

import { synchronise } from "@/src/sync";
import { refreshPendingSyncCount } from "@/src/sync/syncCounters";
import { useStoreSlice } from "@/src/store/storeSlice";
import { useSyncStore } from "@/src/store/syncStore";

export function useManualSync() {
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const syncing = useSyncStore((s) => s.syncing);
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const syncStatus = useSyncStore((s) => s.syncStatus);
  const lastError = useSyncStore((s) => s.lastError);

  useFocusEffect(
    useCallback(() => {
      void refreshPendingSyncCount();
    }, []),
  );

  const triggerSync = useCallback(async () => {
    if (!activeStoreId || syncing) return null;
    const result = await synchronise(activeStoreId);
    await refreshPendingSyncCount();
    return result;
  }, [activeStoreId, syncing]);

  return {
    triggerSync,
    syncing,
    pendingCount,
    lastSyncedAt,
    syncStatus,
    lastError,
  };
}
