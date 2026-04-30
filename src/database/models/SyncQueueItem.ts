import Model from "@nozbe/watermelondb/Model";
import { field } from "@nozbe/watermelondb/decorators";

export default class SyncQueueItem extends Model {
  static table = "sync_queue";

  @field("store_id") storeId!: string;
  @field("entity") entity!: string;
  @field("operation") operation!: string;
  @field("payload") payload!: string;
  @field("record_id") recordId?: string;
  @field("remote_id") remoteId?: string;
  @field("status") status!: string;
  @field("attempts") attempts!: number;
  @field("last_error") lastError?: string;
}
