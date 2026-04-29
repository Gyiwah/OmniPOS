import { useAuthSession } from "@/src/features/auth/hooks";

export function useAuth() {
  return useAuthSession();
}
