import { database } from "@/src/database";
import SyncQueueItem from "@/src/database/models/SyncQueueItem";
import { refreshPendingSyncCount } from "./syncCounters";

export type EnqueueInput = {
  storeId: string;
  entity: "products";
  operation: "upsert" | "delete";
  payload: Record<string, unknown>;
  recordId?: string;
  remoteId?: string;
};

/** Write-through local queue row for cloud push — call after SQLite write completes. */
export async function enqueueChange(input: EnqueueInput): Promise<void> {
  await database.write(async () => {
    await database.get<SyncQueueItem>("sync_queue").create((record) => {
      record.storeId = input.storeId;
      record.entity = input.entity;
      record.operation = input.operation;
      record.payload = JSON.stringify(input.payload);
      record.recordId = input.recordId;
      record.remoteId = input.remoteId;
      record.status = "pending";
      record.attempts = 0;
      record.lastError = undefined;
    });
  });

  await refreshPendingSyncCount();
}
