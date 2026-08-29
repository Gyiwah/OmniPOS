import { useQuery } from "@tanstack/react-query";
import { returnsService } from "./service";
import { useStoreSlice } from "@/src/store/storeSlice";

export function useReturns() {
  const storeId = useStoreSlice((s) => s.activeStoreId);
  return useQuery({
    queryKey: ["returns", storeId],
    queryFn: () => (storeId ? returnsService.list(storeId) : Promise.resolve([])),
    enabled: Boolean(storeId),
  });
}
