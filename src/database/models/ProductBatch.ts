import Model from "@nozbe/watermelondb/Model";
import { field } from "@nozbe/watermelondb/decorators";

export default class ProductBatch extends Model {
  static table = "product_batches";

  @field("store_id") storeId!: string;
  @field("remote_id") remoteId?: string;
  @field("product_id") productId!: string;
  @field("batch_number") batchNumber!: string;
  @field("quantity") quantity!: number;
  @field("cost_price") costPrice?: number;
  @field("expiry_date") expiryDate?: string;
  @field("created_at") createdAt!: number;
  @field("updated_at") updatedAt!: number;
  @field("dirty") dirty!: boolean;
}
