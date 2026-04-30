import { create } from "zustand";

export type DraftLine = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  barcode?: string;
  remoteId?: string;
  sku?: string;
};

type DiscountMode = "percentage" | "amount";

type OrderDraftState = {
  lines: DraftLine[];
  discountMode: DiscountMode;
  discountValue: number;
  amountPaid: number;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  addOrIncrementLine: (line: Omit<DraftLine, "quantity">) => void;
  setLineQty: (id: string, quantity: number) => void;
  removeLine: (id: string) => void;
  setDiscountMode: (mode: DiscountMode) => void;
  setDiscountValue: (value: number) => void;
  setAmountPaid: (value: number) => void;
  setCustomer: (payload: { name?: string; phone?: string; shippingAddress?: string }) => void;
  clearDraft: () => void;
};

const INITIAL: Omit<
  OrderDraftState,
  | "addOrIncrementLine"
  | "setLineQty"
  | "removeLine"
  | "setDiscountMode"
  | "setDiscountValue"
  | "setAmountPaid"
  | "setCustomer"
  | "clearDraft"
> = {
  lines: [],
  discountMode: "percentage",
  discountValue: 0,
  amountPaid: 0,
  customerName: "",
  customerPhone: "",
  shippingAddress: "",
};

export const useOrderDraftStore = create<OrderDraftState>((set) => ({
  ...INITIAL,
  addOrIncrementLine: (line) =>
    set((s) => {
      const found = s.lines.find((x) => x.id === line.id);
      if (found) {
        return {
          lines: s.lines.map((x) => (x.id === line.id ? { ...x, quantity: x.quantity + 1 } : x)),
        };
      }
      return { lines: [...s.lines, { ...line, quantity: 1 }] };
    }),
  setLineQty: (id, quantity) =>
    set((s) => ({
      lines: s.lines
        .map((line) => (line.id === id ? { ...line, quantity: Math.max(0, quantity) } : line))
        .filter((line) => line.quantity > 0),
    })),
  removeLine: (id) =>
    set((s) => ({
      lines: s.lines.filter((line) => line.id !== id),
    })),
  setDiscountMode: (discountMode) => set({ discountMode }),
  setDiscountValue: (discountValue) => set({ discountValue: Number.isFinite(discountValue) ? discountValue : 0 }),
  setAmountPaid: (amountPaid) => set({ amountPaid: Number.isFinite(amountPaid) ? amountPaid : 0 }),
  setCustomer: ({ name, phone, shippingAddress }) =>
    set((s) => ({
      customerName: name ?? s.customerName,
      customerPhone: phone ?? s.customerPhone,
      shippingAddress: shippingAddress ?? s.shippingAddress,
    })),
  clearDraft: () => set(INITIAL),
}));
