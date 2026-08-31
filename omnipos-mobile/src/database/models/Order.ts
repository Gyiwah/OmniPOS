import Model from "@nozbe/watermelondb/Model";
import { field } from "@nozbe/watermelondb/decorators";

export default class Order extends Model {
  static table = "orders";

  @field("store_id") storeId!: string;
  @field("remote_id") remoteId?: string;
  @field("cashier_user_id") cashierUserId!: string;
  @field("order_number") orderNumber!: string;
  @field("status") status!: string;
  @field("subtotal") subtotal!: number;
  @field("tax") tax!: number;
  @field("discount") discount!: number;
  @field("total") total!: number;
  @field("amount_paid") amountPaid!: number;
  @field("change_due") changeDue!: number;
  @field("payment_method") paymentMethod!: string;
  @field("customer_name") customerName?: string;
  @field("customer_phone") customerPhone?: string;
  @field("customer_id") customerId?: string;
  @field("created_at") createdAt!: number;
  @field("dirty") dirty!: boolean;
}
