import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "@/src/store/authStore";

export function useAuthSession() {
  return useAuthStore(
    useShallow((state) => ({ userId: state.userId, role: state.role }))
  );
}
