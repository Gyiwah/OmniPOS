import { useQuery } from "@tanstack/react-query";
import { productsService } from "./service";

export function useProducts() {
  return useQuery({
    queryKey: ["products"],
    queryFn: productsService.list,
  });
}
