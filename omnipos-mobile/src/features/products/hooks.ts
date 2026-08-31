import { useQuery } from "@tanstack/react-query";
import { productsService } from "./service";

export function useProducts(storeId?: string) {
  return useQuery({
    queryKey: ["products", storeId],
    queryFn: () => productsService.list(storeId),
  });
}
