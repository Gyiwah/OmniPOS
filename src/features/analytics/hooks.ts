import { useQuery } from "@tanstack/react-query";
import { analyticsService } from "./service";

export function useAnalyticsSummary() {
  return useQuery({
    queryKey: ["analytics", "summary"],
    queryFn: analyticsService.summary,
  });
}
