import { Model } from "@nozbe/watermelondb";
import { field } from "@nozbe/watermelondb/decorators";

export default class RegisterShift extends Model {
  static table = "register_shifts";

  @field("store_id") storeId!: string;
  @field("remote_id") remoteId?: string;
  @field("cashier_user_id") cashierUserId!: string;
  @field("opened_at") openedAt!: number;
  @field("closed_at") closedAt?: number;
  @field("opening_float") openingFloat!: number;
  @field("cash_sales") cashSales!: number;
  @field("cash_in") cashIn!: number;
  @field("cash_out") cashOut!: number;
  @field("expected_cash") expectedCash!: number;
  @field("actual_cash") actualCash?: number;
  @field("discrepancy") discrepancy?: number;
  @field("status") status!: string; // "open" | "closed"
  @field("notes") notes?: string;
  @field("movements_json") movementsJson?: string;
  @field("dirty") dirty!: boolean;
}
