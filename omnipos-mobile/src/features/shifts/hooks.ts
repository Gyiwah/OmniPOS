import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { shiftsService } from "./service";
import { useStoreSlice } from "@/src/store/storeSlice";
import { useAuthStore } from "@/src/store/authStore";

export function useActiveShift() {
  const storeId = useStoreSlice((s) => s.activeStoreId);
  const userId = useAuthStore((s) => s.userId);

  return useQuery({
    queryKey: ["activeShift", storeId, userId],
    queryFn: () => (storeId ? shiftsService.getActive(storeId, userId ?? undefined) : Promise.resolve(null)),
    enabled: Boolean(storeId),
  });
}

export function useShiftSummary(shiftId?: string | null) {
  return useQuery({
    queryKey: ["shiftSummary", shiftId],
    queryFn: () => (shiftId ? shiftsService.getSummary(shiftId) : Promise.resolve(null)),
    enabled: Boolean(shiftId),
  });
}

export function useShiftMutations() {
  const qc = useQueryClient();
  const storeId = useStoreSlice((s) => s.activeStoreId);
  const userId = useAuthStore((s) => s.userId);

  const openShiftMutation = useMutation({
    mutationFn: ({ openingFloat, notes }: { openingFloat: number; notes?: string }) => {
      if (!storeId) throw new Error("Active store required");
      return shiftsService.open(storeId, userId ?? "cashier", openingFloat, notes);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["activeShift"] });
      void qc.invalidateQueries({ queryKey: ["shifts"] });
    },
  });

  const recordMovementMutation = useMutation({
    mutationFn: ({
      shiftId,
      type,
      amount,
      reason,
    }: {
      shiftId: string;
      type: "in" | "out";
      amount: number;
      reason: string;
    }) => shiftsService.recordMovement(shiftId, type, amount, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["activeShift"] });
      void qc.invalidateQueries({ queryKey: ["shiftSummary"] });
    },
  });

  const closeShiftMutation = useMutation({
    mutationFn: ({ shiftId, actualCash, notes }: { shiftId: string; actualCash: number; notes?: string }) =>
      shiftsService.close(shiftId, actualCash, notes),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["activeShift"] });
      void qc.invalidateQueries({ queryKey: ["shifts"] });
      void qc.invalidateQueries({ queryKey: ["shiftSummary"] });
    },
  });

  return {
    openShift: openShiftMutation.mutateAsync,
    recordMovement: recordMovementMutation.mutateAsync,
    closeShift: closeShiftMutation.mutateAsync,
    isOpenLoading: openShiftMutation.isPending,
    isMovementLoading: recordMovementMutation.isPending,
    isCloseLoading: closeShiftMutation.isPending,
  };
}
