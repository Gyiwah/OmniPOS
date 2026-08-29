import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type StoreSlice = {
  activeStoreId: string | null;
  setActiveStore: (storeId: string | null) => void;
};

export const useStoreSlice = create<StoreSlice>()(
  persist(
    (set) => ({
      activeStoreId: null,
      setActiveStore: (storeId) => set({ activeStoreId: storeId }),
    }),
    {
      name: "omnipos-store-slice-v1",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
