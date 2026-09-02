import { useEffect } from "react";

import { useStoreSettings } from "@/src/features/settings/hooks";
import { resolveStoreLogoUrl } from "@/src/services/storage";
import { useSettingsStore } from "@/src/store/settingsStore";

/**
 * Bring the shop's own details down from the server, at startup.
 *
 * The store's name, email, currency and tax rates all live on the server and
 * are hydrated by `hydrateFromServer` — but the only thing that called it was
 * the Settings screen. A till that nobody had opened Settings on therefore ran
 * on whatever the local defaults happened to be, and printed them on receipts.
 *
 * The rates are the part that costs money. A till applying a tax rate the shop
 * has not set is charging customers for something nobody decided, and the
 * figure is stored on the sale, so it is still wrong when the receipt is
 * reprinted a year later.
 *
 * Runs wherever there is an active store, which is the same condition the query
 * itself is gated on. Failures are silent on purpose: the till already has a
 * persisted copy from last time, and refusing to open because the profile is
 * stale would take a working shop offline over a cosmetic difference.
 */
export function useStoreProfile(): void {
  const { data } = useStoreSettings();
  const hydrate = useSettingsStore((s) => s.hydrateFromServer);

  useEffect(() => {
    if (!data) return;

    let cancelled = false;

    async function apply() {
      if (!data) return;

      // Resolved separately: a stored logo may be a key needing a signed URL
      // rather than something the <Image> can load directly.
      let logo: string | null = null;
      try {
        logo = data.logoUrl ? await resolveStoreLogoUrl(data.logoUrl) : null;
      } catch {
        // A missing logo is not a reason to discard the name and the rates.
        logo = null;
      }

      if (cancelled) return;

      hydrate({
        shopName: data.name,
        shopEmail: data.email ?? "",
        shopLogoUri: logo,
        language: data.language,
        currency: data.currency,
        appModeDark: data.appModeDark,
        taxRate: data.taxRate,
        vatRate: data.vatRate,
        serviceRate: data.serviceRate,
      });
    }

    void apply();

    return () => {
      cancelled = true;
    };
  }, [data, hydrate]);
}
