import { useQuery } from "@tanstack/react-query";
import { storesService } from "./service";

export function useStores() {
  return useQuery({
    queryKey: ["stores"],
    queryFn: storesService.list,
  });
}
