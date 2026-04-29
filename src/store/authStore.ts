import { create } from "zustand";

type AuthState = {
  userId: string | null;
  role: "admin" | "cashier" | "manager" | null;
  setSession: (userId: string, role: AuthState["role"]) => void;
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  role: null,
  setSession: (userId, role) => set({ userId, role }),
  clearSession: () => set({ userId: null, role: null }),
}));
