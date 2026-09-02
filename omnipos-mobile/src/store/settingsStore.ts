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

/**
 * Shown where a shop name is required and the server has not supplied one yet:
 * a first run, or a till that has never had a connection.
 *
 * Deliberately obvious. It reads as a setup step left undone, which is what it
 * is — unlike a plausible-looking name, which reads as fact and was wrong.
 */
export const UNNAMED_STORE = "Unnamed store";

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      /*
       * Blank until the server says otherwise. These are not settings, they are
       * placeholders for settings that have not arrived yet, and every one of
       * them used to be a specific shop's real details: a name and a working
       * personal email address, shipped to every till and printed at the top of
       * every receipt until somebody opened Settings.
       *
       * The rates matter more than the name. A fabricated 2% was applied to
       * real sales on a till nobody had configured — money taken from a
       * customer that the shop had never asked for. A rate this app invented is
       * always wrong; zero is at worst incomplete, and the server supplies the
       * real one on startup.
       */
      shopName: "",
      shopEmail: "",
      shopLogoUri: null,
      language: "English",
      currency: "GHS",
      appModeDark: false,
      taxRate: 0,
      vatRate: 0,
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
