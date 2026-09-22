import { storage } from "@/src/core/platform";
import { setActiveStore as setApiActiveStore } from "@/src/core/api/client";
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
      setActiveStore: (storeId) => {
        setApiActiveStore(storeId);
        set({ activeStoreId: storeId });
      },
    }),
    {
      name: "omnipos-store-slice-v1",
      storage: createJSONStorage(() => storage),
    },
  ),
);
