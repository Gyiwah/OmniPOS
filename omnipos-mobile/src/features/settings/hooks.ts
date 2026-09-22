import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useStoreSlice } from "@/src/store/storeSlice";
import { useSettingsStore } from "@/src/store/settingsStore";

import { settingsService } from "./service";
import type { AddUserInput, SendInviteInput, StoreSettingsInput } from "./types";

export function useStoreSettings() {
  const storeId = useStoreSlice((s) => s.activeStoreId);

  return useQuery({
    queryKey: ["store-settings", storeId],
    queryFn: () => settingsService.getByStoreId(storeId!),
    enabled: Boolean(storeId),
  });
}

export function useSaveStoreSettings() {
  const storeId = useStoreSlice((s) => s.activeStoreId);
  const queryClient = useQueryClient();
  const hydrate = useSettingsStore((s) => s.hydrateFromServer);

  return useMutation({
    mutationFn: async (input: StoreSettingsInput & { localLogoUri?: string | null }) => {
      if (!storeId) throw new Error("No active store selected.");

      let logoUrl = input.logoUrl;
      if (input.localLogoUri) {
        logoUrl = await settingsService.uploadLogo(storeId, input.localLogoUri);
      }

      return settingsService.update(storeId, { ...input, logoUrl });
    },
    onSuccess: async (settings) => {
      const logoUri = settings.logoUrl ? await settingsService.resolveLogoUrl(settings.logoUrl) : null;
      hydrate({
        shopName: settings.name,
        shopEmail: settings.email ?? "",
        shopLogoUri: logoUri,
        language: settings.language,
        currency: settings.currency,
        appModeDark: settings.appModeDark,
        taxRate: settings.taxRate,
        vatRate: settings.vatRate,
        serviceRate: settings.serviceRate,
      });
      await queryClient.invalidateQueries({ queryKey: ["store-settings", storeId] });
      await queryClient.invalidateQueries({ queryKey: ["stores"] });
    },
  });
}

export function useStoreTeamMembers() {
  const storeId = useStoreSlice((s) => s.activeStoreId);

  return useQuery({
    queryKey: ["store-members", storeId],
    queryFn: () => settingsService.listMembers(storeId!),
    enabled: Boolean(storeId),
  });
}

export function usePendingInvites() {
  const storeId = useStoreSlice((s) => s.activeStoreId);

  return useQuery({
    queryKey: ["store-invites", storeId],
    queryFn: () => settingsService.listPendingInvites(storeId!),
    enabled: Boolean(storeId),
  });
}

export function useSendInvite() {
  const storeId = useStoreSlice((s) => s.activeStoreId);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SendInviteInput) => {
      if (!storeId) throw new Error("No active store selected.");
      return settingsService.sendInvite(storeId, input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["store-invites", storeId] });
      void queryClient.invalidateQueries({ queryKey: ["store-members", storeId] });
    },
  });
}

export function useAddUser() {
  const storeId = useStoreSlice((s) => s.activeStoreId);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AddUserInput) => {
      if (!storeId) throw new Error("No active store selected.");
      return settingsService.addUser(storeId, input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["store-members", storeId] });
    },
  });
}

export function useRevokeInvite() {
  const storeId = useStoreSlice((s) => s.activeStoreId);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (inviteId: string) => {
      if (!storeId) throw new Error("No active store selected.");
      return settingsService.revokeInvite(storeId, inviteId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["store-invites", storeId] });
    },
  });
}

export function useExportStoreCsv() {
  const storeId = useStoreSlice((s) => s.activeStoreId);

  return useMutation({
    mutationFn: () => {
      if (!storeId) throw new Error("No active store selected.");
      return settingsService.exportStoreCsv(storeId);
    },
  });
}
