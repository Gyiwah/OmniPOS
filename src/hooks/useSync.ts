import { runSyncCycle } from "@/src/sync/syncEngine";
import { useStoreSlice } from "@/src/store/storeSlice";

export function useSync() {
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  return {
    syncNow: () => runSyncCycle(activeStoreId),
  };
}
