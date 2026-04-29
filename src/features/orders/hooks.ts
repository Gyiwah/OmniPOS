import { useQuery } from "@tanstack/react-query";
import { ordersService } from "./service";

export function useOrders() {
  return useQuery({
    queryKey: ["orders"],
    queryFn: ordersService.list,
  });
}
