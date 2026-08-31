import { Q } from "@nozbe/watermelondb";
import Toast from "react-native-toast-message";
import { database } from "@/src/database";
import type Product from "@/src/database/models/Product";
import type ProductBatch from "@/src/database/models/ProductBatch";

export type LowStockItemAlert = {
  id: string;
  name: string;
  sku: string;
  stock: number;
  reorderLevel: number;
};

export type ExpiryBatchAlert = {
  id: string;
  productId: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  status: "expired" | "expiring_soon";
  daysLeft: number;
};

export type StockHealthSummary = {
  lowStockCount: number;
  lowStockItems: LowStockItemAlert[];
  expiringSoonCount: number;
  expiringBatches: ExpiryBatchAlert[];
  expiredCount: number;
  expiredBatches: ExpiryBatchAlert[];
};

export const notificationsService = {
  /**
   * Evaluates local WatermelonDB catalog for low stock and expiring batch alerts.
   */
  async checkStockHealth(storeId: string): Promise<StockHealthSummary> {
    if (!storeId) {
      return {
        lowStockCount: 0,
        lowStockItems: [],
        expiringSoonCount: 0,
        expiringBatches: [],
        expiredCount: 0,
        expiredBatches: [],
      };
    }

    const lowStockItems: LowStockItemAlert[] = [];
    const expiringBatches: ExpiryBatchAlert[] = [];
    const expiredBatches: ExpiryBatchAlert[] = [];

    // 1. Check Low Stock Products
    try {
      const products = await database
        .get<Product>("products")
        .query(Q.where("store_id", storeId))
        .fetch();

      products.forEach((p) => {
        const threshold = p.reorderLevel && p.reorderLevel > 0 ? p.reorderLevel : 5;
        if (p.stock <= threshold) {
          lowStockItems.push({
            id: p.id,
            name: p.name,
            sku: p.sku,
            stock: p.stock,
            reorderLevel: threshold,
          });
        }
      });
    } catch {
      // ignore
    }

    // 2. Check Expiring & Expired Batches
    try {
      const batches = await database
        .get<ProductBatch>("product_batches")
        .query(Q.where("store_id", storeId), Q.where("quantity", Q.gt(0)))
        .fetch();

      const now = new Date();
      now.setHours(0, 0, 0, 0);

      batches.forEach((b) => {
        if (!b.expiryDate) return;
        const exp = new Date(b.expiryDate);
        exp.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays <= 0) {
          expiredBatches.push({
            id: b.id,
            productId: b.productId,
            batchNumber: b.batchNumber,
            quantity: b.quantity,
            expiryDate: b.expiryDate,
            status: "expired",
            daysLeft: diffDays,
          });
        } else if (diffDays <= 30) {
          expiringBatches.push({
            id: b.id,
            productId: b.productId,
            batchNumber: b.batchNumber,
            quantity: b.quantity,
            expiryDate: b.expiryDate,
            status: "expiring_soon",
            daysLeft: diffDays,
          });
        }
      });
    } catch {
      // ignore
    }

    return {
      lowStockCount: lowStockItems.length,
      lowStockItems,
      expiringSoonCount: expiringBatches.length,
      expiringBatches,
      expiredCount: expiredBatches.length,
      expiredBatches,
    };
  },

  /**
   * Displays an in-app banner/toast if there are low stock or expired inventory warnings.
   */
  async notifyLowStock(storeId?: string) {
    if (!storeId) return;

    try {
      const health = await this.checkStockHealth(storeId);

      if (health.expiredCount > 0) {
        Toast.show({
          type: "error",
          text1: "Expired Inventory Warning",
          text2: `${health.expiredCount} batch${health.expiredCount > 1 ? "es have" : " has"} expired and require immediate action.`,
          position: "top",
          visibilityTime: 4000,
        });
      } else if (health.lowStockCount > 0) {
        Toast.show({
          type: "info",
          text1: "Low Stock Alert",
          text2: `${health.lowStockCount} product${health.lowStockCount > 1 ? "s are" : " is"} running below reorder levels.`,
          position: "top",
          visibilityTime: 4000,
        });
      }
    } catch {
      // ignore notification errors
    }
  },
};
