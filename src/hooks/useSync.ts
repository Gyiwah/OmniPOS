import { runSync } from "@/src/database/sync";

export function useSync() {
  return {
    syncNow: runSync,
  };
}
