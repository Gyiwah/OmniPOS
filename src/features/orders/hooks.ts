import { useQuery } from "@tanstack/react-query";
import { ordersService } from "./service";

export function useOrders(storeId?: string, limit = 100) {
  return useQuery({
    queryKey: ["orders", storeId, limit],
    queryFn: () => ordersService.list(storeId, limit),
  });
}
