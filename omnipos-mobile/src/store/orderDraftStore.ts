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

export type DiscountMode = "percentage" | "amount";

export type PaymentMethod = "cash" | "card" | "transfer" | "momo";

export type ParkedOrder = {
  id: string;
  tag: string;
  lines: DraftLine[];
  customerName?: string;
  customerPhone?: string;
  customerId?: string;
  shippingAddress?: string;
  discountMode: DiscountMode;
  discountValue: number;
  parkedAt: number;
};

type OrderDraftState = {
  lines: DraftLine[];
  discountMode: DiscountMode;
  discountValue: number;
  amountPaid: number;
  paymentMethod: PaymentMethod;
  customerName: string;
  customerPhone: string;
  customerId?: string;
  shippingAddress: string;
  parkedOrders: ParkedOrder[];

  addOrIncrementLine: (line: Omit<DraftLine, "quantity">) => void;
  setLineQty: (id: string, quantity: number) => void;
  removeLine: (id: string) => void;
  setDiscountMode: (mode: DiscountMode) => void;
  setDiscountValue: (value: number) => void;
  setAmountPaid: (value: number) => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setCustomer: (payload: { id?: string; name?: string; phone?: string; shippingAddress?: string }) => void;
  clearDraft: () => void;

  parkCurrentCart: (tag?: string) => string | null;
  resumeParkedCart: (id: string) => void;
  deleteParkedCart: (id: string) => void;
};

const INITIAL = {
  lines: [],
  discountMode: "percentage" as DiscountMode,
  discountValue: 0,
  amountPaid: 0,
  paymentMethod: "cash" as PaymentMethod,
  customerName: "",
  customerPhone: "",
  customerId: undefined,
  shippingAddress: "",
};

export const useOrderDraftStore = create<OrderDraftState>((set, get) => ({
  ...INITIAL,
  parkedOrders: [],

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
  setPaymentMethod: (paymentMethod) => set({ paymentMethod }),

  setCustomer: ({ id, name, phone, shippingAddress }) =>
    set((s) => ({
      customerId: id ?? s.customerId,
      customerName: name ?? s.customerName,
      customerPhone: phone ?? s.customerPhone,
      shippingAddress: shippingAddress ?? s.shippingAddress,
    })),

  clearDraft: () => set(INITIAL),

  parkCurrentCart: (tag) => {
    const s = get();
    if (s.lines.length === 0) return null;

    const parkedId = `park-${Date.now().toString().slice(-6)}`;
    const newParked: ParkedOrder = {
      id: parkedId,
      tag: tag?.trim() || `Tab #${s.parkedOrders.length + 1}`,
      lines: [...s.lines],
      customerName: s.customerName || undefined,
      customerPhone: s.customerPhone || undefined,
      customerId: s.customerId || undefined,
      shippingAddress: s.shippingAddress || undefined,
      discountMode: s.discountMode,
      discountValue: s.discountValue,
      parkedAt: Date.now(),
    };

    set({
      ...INITIAL,
      parkedOrders: [newParked, ...s.parkedOrders],
    });

    return parkedId;
  },

  resumeParkedCart: (id) => {
    const s = get();
    const target = s.parkedOrders.find((p) => p.id === id);
    if (!target) return;

    set({
      lines: target.lines,
      customerName: target.customerName || "",
      customerPhone: target.customerPhone || "",
      customerId: target.customerId,
      shippingAddress: target.shippingAddress || "",
      discountMode: target.discountMode,
      discountValue: target.discountValue,
      parkedOrders: s.parkedOrders.filter((p) => p.id !== id),
    });
  },

  deleteParkedCart: (id) =>
    set((s) => ({
      parkedOrders: s.parkedOrders.filter((p) => p.id !== id),
    })),
}));
