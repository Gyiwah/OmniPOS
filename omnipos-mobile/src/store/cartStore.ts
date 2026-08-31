import { create } from "zustand";

type CartItem = { productId: string; quantity: number; price: number };

type CartState = {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  clear: () => void;
};

export const useCartStore = create<CartState>((set) => ({
  items: [],
  addItem: (item) => set((state) => ({ items: [...state.items, item] })),
  clear: () => set({ items: [] }),
}));
