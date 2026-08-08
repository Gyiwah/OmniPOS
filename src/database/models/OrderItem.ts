import Model from "@nozbe/watermelondb/Model";
import { field } from "@nozbe/watermelondb/decorators";

export default class OrderItem extends Model {
  static table = "order_items";

  @field("order_id") orderId!: string;
  @field("store_id") storeId!: string;
  @field("product_id") productId?: string;
  @field("product_name") productName!: string;
  @field("sku") sku?: string;
  @field("barcode") barcode?: string;
  @field("unit_price") unitPrice!: number;
  @field("quantity") quantity!: number;
  @field("line_total") lineTotal!: number;
}
