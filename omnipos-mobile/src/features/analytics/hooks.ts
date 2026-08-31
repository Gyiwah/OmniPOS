import { useQuery } from "@tanstack/react-query";
import { analyticsService } from "./service";
import type { TimeRange } from "./types";

export function useStoreAnalytics(storeId: string | null | undefined, range: TimeRange = "30d") {
  return useQuery({
    queryKey: ["analytics", "store", storeId, range],
    queryFn: () => (storeId ? analyticsService.getStoreAnalytics(storeId, range) : null),
    enabled: Boolean(storeId),
    staleTime: 1000 * 30, // 30 seconds
  });
}

export function useAnalyticsSummary(storeId?: string | null) {
  return useQuery({
    queryKey: ["analytics", "summary", storeId],
    queryFn: () => analyticsService.summary(storeId ?? undefined),
    enabled: Boolean(storeId),
    staleTime: 1000 * 60, // 1 minute
  });
}
