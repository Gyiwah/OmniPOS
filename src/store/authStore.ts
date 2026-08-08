import { create } from "zustand";

type AuthState = {
  userId: string | null;
  role: "super_admin" | "admin" | "cashier" | "manager" | null;
  isSuperAdmin: boolean;
  setSession: (userId: string, role: AuthState["role"], isSuperAdmin?: boolean) => void;
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  role: null,
  isSuperAdmin: false,
  setSession: (userId, role, isSuperAdmin = false) => set({ userId, role, isSuperAdmin }),
  clearSession: () => set({ userId: null, role: null, isSuperAdmin: false }),
}));
