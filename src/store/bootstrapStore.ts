import { create } from "zustand";

type BootstrapStore = {
  ready: boolean;
  setReady: (ready: boolean) => void;
};

export const useBootstrapStore = create<BootstrapStore>((set) => ({
  ready: false,
  setReady: (ready) => set({ ready }),
}));
