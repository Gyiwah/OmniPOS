import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "@/src/core/platform";

type SettingsState = {
  shopName: string;
  shopEmail: string;
  shopLogoUri: string | null;
  language: string;
  currency: string;
  appModeDark: boolean;
  taxRate: number;
  vatRate: number;
  serviceRate: number;
  setShopProfile: (payload: { name?: string; email?: string; logoUri?: string | null }) => void;
  setLanguage: (value: string) => void;
  setCurrency: (value: string) => void;
  setAppModeDark: (value: boolean) => void;
  setCharges: (payload: { taxRate?: number; vatRate?: number; serviceRate?: number }) => void;
  hydrateFromServer: (payload: {
    shopName: string;
    shopEmail: string;
    shopLogoUri: string | null;
    language: string;
    currency: string;
    appModeDark: boolean;
    taxRate: number;
    vatRate: number;
    serviceRate: number;
  }) => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      shopName: "Superb Media",
      shopEmail: "superbmedi63@gmail.com",
      shopLogoUri: null,
      language: "English",
      currency: "GHS",
      appModeDark: false,
      taxRate: 2,
      vatRate: 0.02,
      serviceRate: 0,
      setShopProfile: ({ name, email, logoUri }) =>
        set((s) => ({
          shopName: name ?? s.shopName,
          shopEmail: email ?? s.shopEmail,
          shopLogoUri: logoUri === undefined ? s.shopLogoUri : logoUri,
        })),
      setLanguage: (language) => set({ language }),
      setCurrency: (currency) => set({ currency }),
      setAppModeDark: (appModeDark) => set({ appModeDark }),
      setCharges: ({ taxRate, vatRate, serviceRate }) =>
        set((s) => ({
          taxRate: taxRate ?? s.taxRate,
          vatRate: vatRate ?? s.vatRate,
          serviceRate: serviceRate ?? s.serviceRate,
        })),
      hydrateFromServer: (payload) => set(payload),
    }),
    {
      name: "omnipos-settings-v1",
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({
        shopName: s.shopName,
        shopEmail: s.shopEmail,
        shopLogoUri: s.shopLogoUri,
        language: s.language,
        currency: s.currency,
        appModeDark: s.appModeDark,
        taxRate: s.taxRate,
        vatRate: s.vatRate,
        serviceRate: s.serviceRate,
      }),
    },
  ),
);
