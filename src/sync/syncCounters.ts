import { Q } from "@nozbe/watermelondb";
import { database } from "@/src/database";
import SyncQueueItem from "@/src/database/models/SyncQueueItem";
import { useSyncStore } from "@/src/store/syncStore";

export async function refreshPendingSyncCount(): Promise<number> {
  const rows = await database.get<SyncQueueItem>("sync_queue").query(Q.where("status", "pending")).fetch();
  const pending = rows.length;
  useSyncStore.getState().setPendingCount(pending);
  return pending;
}
