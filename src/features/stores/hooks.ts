import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { storesService } from "./service";

export function useStores() {
  return useQuery({
    queryKey: ["stores"],
    queryFn: storesService.list,
  });
}

export function useCreateStore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => storesService.create(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stores"] });
    },
  });
}
