import { SalesSummary } from "@/src/types/analytics";

export const analyticsService = {
  async summary(): Promise<SalesSummary> {
    return { grossSales: 0, orderCount: 0, returnAmount: 0 };
  },
};
