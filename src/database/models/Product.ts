import Model from "@nozbe/watermelondb/Model";
import { field } from "@nozbe/watermelondb/decorators";

export default class Product extends Model {
  static table = "products";

  @field("store_id") storeId!: string;
  @field("remote_id") remoteId?: string;
  @field("name") name!: string;
  @field("sku") sku!: string;
  @field("barcode") barcode?: string;
  @field("stock") stock!: number;
  @field("sell_price") sellPrice!: number;
  @field("cost_price") costPrice?: number;
  @field("reorder_level") reorderLevel?: number;
  @field("image_url") imageUrl?: string;
  @field("updated_at") updatedAt!: number;
  @field("dirty") dirty!: boolean;
}
