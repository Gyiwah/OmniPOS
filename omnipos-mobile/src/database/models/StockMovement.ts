import Model from "@nozbe/watermelondb/Model";
import { field } from "@nozbe/watermelondb/decorators";

export default class StockMovement extends Model {
  static table = "stock_movements";

  @field("store_id") storeId!: string;
  @field("remote_id") remoteId?: string;
  @field("product_id") productId!: string;
  @field("batch_id") batchId?: string;
  @field("type") type!: string; // 'STOCK_IN' | 'STOCK_OUT' | 'SALE' | 'RETURN' | 'ADJUSTMENT' | 'DAMAGE' | 'EXPIRED' | 'AUDIT'
  @field("quantity") quantity!: number;
  @field("quantity_before") quantityBefore!: number;
  @field("quantity_after") quantityAfter!: number;
  @field("reason") reason!: string;
  @field("notes") notes?: string;
  /** What caused this movement: 'order' plus the sale's id, for example. */
  @field("source_type") sourceType?: string;
  @field("source_id") sourceId?: string;
  @field("created_at") createdAt!: number;
  @field("dirty") dirty!: boolean;
}
