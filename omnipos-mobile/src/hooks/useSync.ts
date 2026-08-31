import { synchronise } from "@/src/sync";
import { useStoreSlice } from "@/src/store/storeSlice";

export function useSync() {
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  return {
    syncNow: () => synchronise(activeStoreId),
  };
}
