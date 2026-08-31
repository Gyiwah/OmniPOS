import { Q } from "@nozbe/watermelondb";
import { database } from "@/src/database";
import type Product from "@/src/database/models/Product";

export const productsService = {
  async list(storeId?: string): Promise<Product[]> {
    if (!storeId) {
      return database.get<Product>("products").query().fetch();
    }
    return database
      .get<Product>("products")
      .query(Q.where("store_id", storeId), Q.sortBy("name", Q.asc))
      .fetch();
  },

  async findById(productId: string): Promise<Product | null> {
    try {
      return await database.get<Product>("products").find(productId);
    } catch {
      return null;
    }
  },

  async findByBarcode(storeId: string, barcode: string): Promise<Product | null> {
    try {
      const items = await database
        .get<Product>("products")
        .query(Q.where("store_id", storeId), Q.where("barcode", barcode))
        .fetch();
      return items[0] ?? null;
    } catch {
      return null;
    }
  },
};
