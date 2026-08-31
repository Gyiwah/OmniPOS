import { Q } from "@nozbe/watermelondb";
import { database } from "@/src/database";
import type Order from "@/src/database/models/Order";
import type OrderItem from "@/src/database/models/OrderItem";

export const ordersService = {
  async list(storeId?: string, limit = 100): Promise<Order[]> {
    if (!storeId) {
      return database.get<Order>("orders").query(Q.sortBy("created_at", Q.desc), Q.take(limit)).fetch();
    }
    return database
      .get<Order>("orders")
      .query(Q.where("store_id", storeId), Q.sortBy("created_at", Q.desc), Q.take(limit))
      .fetch();
  },

  async findById(orderId: string): Promise<Order | null> {
    try {
      return await database.get<Order>("orders").find(orderId);
    } catch {
      return null;
    }
  },

  async getOrderItems(orderId: string): Promise<OrderItem[]> {
    try {
      return await database
        .get<OrderItem>("order_items")
        .query(Q.where("order_id", orderId))
        .fetch();
    } catch {
      return [];
    }
  },
};
