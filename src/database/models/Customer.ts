import Model from "@nozbe/watermelondb/Model";
import { field } from "@nozbe/watermelondb/decorators";

export default class Customer extends Model {
  static table = "customers";

  @field("store_id") storeId!: string;
  @field("remote_id") remoteId?: string;
  @field("name") name!: string;
  @field("phone") phone?: string;
  @field("email") email?: string;
  @field("total_spend") totalSpend!: number;
  @field("outstanding_balance") outstandingBalance!: number;
  @field("notes") notes?: string;
  @field("updated_at") updatedAt!: number;
  @field("dirty") dirty!: boolean;
}
