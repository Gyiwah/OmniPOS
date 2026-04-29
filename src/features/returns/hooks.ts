import { useQuery } from "@tanstack/react-query";
import { returnsService } from "./service";

export function useReturns() {
  return useQuery({
    queryKey: ["returns"],
    queryFn: returnsService.list,
  });
}
