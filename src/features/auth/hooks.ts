import { useAuthStore } from "@/src/store/authStore";

export function useAuthSession() {
  return useAuthStore((state) => ({ userId: state.userId, role: state.role }));
}
