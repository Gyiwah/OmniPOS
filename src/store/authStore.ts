import { storage } from "@/src/core/platform";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type AuthState = {
  userId: string | null;
  role: "super_admin" | "admin" | "cashier" | "manager" | null;
  isSuperAdmin: boolean;
  setSession: (userId: string, role: AuthState["role"], isSuperAdmin?: boolean) => void;
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      userId: null,
      role: null,
      isSuperAdmin: false,
      setSession: (userId, role, isSuperAdmin = false) => set({ userId, role, isSuperAdmin }),
      clearSession: () => set({ userId: null, role: null, isSuperAdmin: false }),
    }),
    {
      name: "omnipos-auth-v1",
      storage: createJSONStorage(() => storage),
    },
  ),
);
