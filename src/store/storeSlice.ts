import { create } from "zustand";

type StoreSlice = {
  activeStoreId: string | null;
  setActiveStore: (storeId: string | null) => void;
};

export const useStoreSlice = create<StoreSlice>((set) => ({
  activeStoreId: null,
  setActiveStore: (storeId) => set({ activeStoreId: storeId }),
}));
