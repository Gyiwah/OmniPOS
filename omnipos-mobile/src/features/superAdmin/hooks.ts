import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { superAdminService } from "./service";
import type { ProvisionStoreInput } from "./types";

export function useAllSystemStores() {
  return useQuery({
    queryKey: ["superAdmin", "stores"],
    queryFn: superAdminService.listAllStores,
  });
}

export function useProvisionStoreWithAdmin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ProvisionStoreInput) => superAdminService.provisionStoreWithAdmin(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "stores"] });
      void queryClient.invalidateQueries({ queryKey: ["stores"] });
    },
  });
}
