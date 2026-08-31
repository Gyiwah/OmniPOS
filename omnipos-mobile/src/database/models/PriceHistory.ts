import Model from "@nozbe/watermelondb/Model";
import { field } from "@nozbe/watermelondb/decorators";

export default class PriceHistory extends Model {
  static table = "price_history";

  @field("store_id") storeId!: string;
  @field("remote_id") remoteId?: string;
  @field("product_id") productId!: string;
  @field("old_sell_price") oldSellPrice!: number;
  @field("new_sell_price") newSellPrice!: number;
  @field("old_cost_price") oldCostPrice?: number;
  @field("new_cost_price") newCostPrice?: number;
  @field("reason") reason?: string;
  @field("created_at") createdAt!: number;
  @field("dirty") dirty!: boolean;
}
