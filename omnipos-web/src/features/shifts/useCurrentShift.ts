import { useLiveQuery } from "dexie-react-hooks";

import { db, type LocalShift } from "@/db/schema";
import { useSession } from "@/state/session";

/**
 * The drawer this cashier has open on this till, live.
 *
 * Scoped to the signed-in user, not just the store: two cashiers sharing a
 * terminal each count their own drawer, and attributing one's sales to the
 * other's shift is how a variance appears out of nowhere.
 */
export function useCurrentShift(): LocalShift | null {
  const storeId = useSession((s) => s.storeId);
  const userId = useSession((s) => s.user?.id);

  return (
    useLiveQuery(
      async () => {
        if (!storeId || !userId) return null;
        const rows = await db.shifts.where("store_id").equals(storeId).toArray();
        return rows.find((s) => s.status === "open" && s.cashier_user_id === userId) ?? null;
      },
      [storeId, userId],
      null,
    ) ?? null
  );
}
