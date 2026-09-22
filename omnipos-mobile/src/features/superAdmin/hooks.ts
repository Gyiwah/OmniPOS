import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { superAdminService } from "./service";
import { laravelSuperAdminService } from "./laravelSuperAdmin";
import type {
  CreateGlobalCategoryInput,
  CreatePersonInput,
  CreatePlanInput,
  PlatformBranch,
  PlatformDevice,
  PlatformStore,
  ProvisionStoreInput,
  UpdateGlobalCategoryInput,
  UpdatePersonInput,
  UpdatePlanInput,
  UpdateStoreInput,
} from "./types";

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
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "platform-stores"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["stores"] });
    },
  });
}

export function usePlatformDashboard() {
  return useQuery({ queryKey: ["superAdmin", "dashboard"], queryFn: laravelSuperAdminService.dashboard });
}

export function usePlatformStores() {
  return useQuery({ queryKey: ["superAdmin", "platform-stores"], queryFn: laravelSuperAdminService.listPlatformStores });
}

export function useStoreMembers(storeId: string | null) {
  return useQuery({
    queryKey: ["superAdmin", "store-members", storeId],
    queryFn: () => (storeId ? laravelSuperAdminService.getStoreMembers(storeId) : Promise.resolve([])),
    enabled: Boolean(storeId),
  });
}

export function useUpdateStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, input }: { storeId: string; input: UpdateStoreInput }) =>
      laravelSuperAdminService.updateStore(storeId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "platform-stores"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "stores"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "dashboard"] });
    },
  });
}

export function useUpdateStoreStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, status }: { storeId: string; status: PlatformStore["status"] }) =>
      laravelSuperAdminService.updateStoreStatus(storeId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "platform-stores"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "stores"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "dashboard"] });
    },
  });
}

export function useDeleteStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (storeId: string) => laravelSuperAdminService.deleteStore(storeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "platform-stores"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "stores"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "branches"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "dashboard"] });
    },
  });
}

export function usePlatformBranches() {
  return useQuery({ queryKey: ["superAdmin", "branches"], queryFn: laravelSuperAdminService.listBranches });
}

export function useCreateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; parentStoreId: string; currency?: string; timezone?: string }) =>
      laravelSuperAdminService.createBranch(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "branches"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "platform-stores"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "dashboard"] });
    },
  });
}

export function useUpdateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, input }: { branchId: string; input: { name?: string; status?: PlatformBranch["status"] } }) =>
      laravelSuperAdminService.updateBranch(branchId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "branches"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "platform-stores"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "dashboard"] });
    },
  });
}

export function useDeleteBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (branchId: string) => laravelSuperAdminService.deleteBranch(branchId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "branches"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "platform-stores"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "dashboard"] });
    },
  });
}

export function usePlatformPeople() {
  return useQuery({ queryKey: ["superAdmin", "people"], queryFn: laravelSuperAdminService.listPeople });
}

export function useCreatePerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePersonInput) => laravelSuperAdminService.createPerson(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "people"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "dashboard"] });
    },
  });
}

export function useUpdatePerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: UpdatePersonInput }) =>
      laravelSuperAdminService.updatePerson(userId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "people"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "dashboard"] });
    },
  });
}

export function useUpdateStoreMembershipRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, storeId, role }: { userId: string; storeId: string; role: string }) =>
      laravelSuperAdminService.updateStoreMembershipRole(userId, storeId, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "people"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "store-members"] });
    },
  });
}

export function useSetPlatformAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, isSuperAdmin }: { userId: string; isSuperAdmin: boolean }) =>
      laravelSuperAdminService.setPlatformAdmin(userId, isSuperAdmin),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "people"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "dashboard"] });
    },
  });
}

export function useDeletePerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => laravelSuperAdminService.deletePerson(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "people"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "dashboard"] });
    },
  });
}

export function usePlatformDevices() {
  return useQuery({ queryKey: ["superAdmin", "devices"], queryFn: laravelSuperAdminService.listDevices });
}

export function useUpdateDeviceStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceId, status }: { deviceId: string; status: PlatformDevice["status"] }) =>
      laravelSuperAdminService.updateDeviceStatus(deviceId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "devices"] });
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "dashboard"] });
    },
  });
}

export function usePlatformSync() {
  return useQuery({ queryKey: ["superAdmin", "sync"], queryFn: laravelSuperAdminService.syncMonitor, refetchInterval: 30000 });
}

export function usePlatformAuditLogs(filter?: { action?: string; storeId?: string }) {
  return useQuery({
    queryKey: ["superAdmin", "audit", filter],
    queryFn: () => laravelSuperAdminService.auditLogs(filter),
  });
}

export function usePlatformResources() {
  return useQuery({ queryKey: ["superAdmin", "resources"], queryFn: laravelSuperAdminService.resources });
}

export function useCreateGlobalCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGlobalCategoryInput) => laravelSuperAdminService.createGlobalCategory(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "resources"] });
    },
  });
}

export function useUpdateGlobalCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, input }: { categoryId: string; input: UpdateGlobalCategoryInput }) =>
      laravelSuperAdminService.updateGlobalCategory(categoryId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "resources"] });
    },
  });
}

export function useDeleteGlobalCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => laravelSuperAdminService.deleteGlobalCategory(categoryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "resources"] });
    },
  });
}

export function useUpdateSystemSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value, description }: { key: string; value: Record<string, unknown>; description?: string }) =>
      laravelSuperAdminService.updateSystemSetting(key, value, description),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "resources"] });
    },
  });
}

export function usePlatformBilling() {
  return useQuery({ queryKey: ["superAdmin", "billing"], queryFn: laravelSuperAdminService.billing });
}

export function useCreatePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlanInput) => laravelSuperAdminService.createPlan(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "billing"] });
    },
  });
}

export function useUpdatePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, input }: { planId: string; input: UpdatePlanInput }) =>
      laravelSuperAdminService.updatePlan(planId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "billing"] });
    },
  });
}

export function useDeletePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) => laravelSuperAdminService.deletePlan(planId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "billing"] });
    },
  });
}

export function useAssignSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, planId, status }: { storeId: string; planId: string; status?: "active" | "suspended" | "expired" }) =>
      laravelSuperAdminService.assignSubscription(storeId, planId, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["superAdmin", "billing"] });
    },
  });
}
