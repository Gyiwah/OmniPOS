import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/api/client";
import { useSession } from "@/state/session";
import { CategoriesSection } from "./CategoriesSection";
import { StaffSection } from "./StaffSection";

type StoreSettings = {
  id: string;
  name: string;
  email: string | null;
  currency: string;
  timezone: string;
  tax_profile: string;
  tax_rate: string;
  vat_rate: string;
  service_rate: string;
};

/**
 * Store settings and staff.
 *
 * Deliberately online-only, and it says so when it cannot reach the server.
 * These are not till operations — nobody changes a VAT rate mid-queue — and
 * queueing them offline would let two managers set different rates on different
 * devices with no way to tell which was meant. Selling keeps working regardless.
 */
export function SettingsPage() {
  const can = useSession((s) => s.can);
  const storeId = useSession((s) => s.storeId);
  const isAdmin = can(["admin"]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["store-settings", storeId],
    queryFn: async () => (await api.get<{ data: StoreSettings }>("/api/store")).data,
    enabled: Boolean(storeId),
  });

  if (isLoading) return <div className="page"><p className="muted">Loading settings…</p></div>;

  if (error || !data) {
    const offline = error instanceof ApiError && error.isUnreachable;
    return (
      <div className="page">
        <h1>Settings</h1>
        <p className="notice notice-warn">
          {offline
            ? "Settings need a connection. Selling, returns and the drawer all keep working offline."
            : error instanceof Error
              ? error.message
              : "Could not load settings."}
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Settings</h1>
        <p className="muted">{data.name}</p>
      </header>

      <StoreDetails settings={data} canEdit={isAdmin} />
      <CategoriesSection />
      <StaffSection />
    </div>
  );
}

function StoreDetails({ settings, canEdit }: { settings: StoreSettings; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const selectStore = useSession((s) => s.selectStore);
  const storeId = useSession((s) => s.storeId);

  const [form, setForm] = useState({
    name: settings.name,
    email: settings.email ?? "",
    currency: settings.currency,
    timezone: settings.timezone,
    tax_rate: settings.tax_rate,
    vat_rate: settings.vat_rate,
    service_rate: settings.service_rate,
  });
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api.patch<{ data: StoreSettings }>("/api/store", {
        name: form.name,
        email: form.email || null,
        currency: form.currency,
        timezone: form.timezone,
        tax_rate: Number(form.tax_rate),
        vat_rate: Number(form.vat_rate),
        service_rate: Number(form.service_rate),
      }),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ["store-settings"] });
      // The till prices from the session's copy of these rates, so it has to be
      // refreshed here or the next sale is rung up at the old VAT.
      if (storeId) await selectStore(storeId);
    },
  });

  const field = (key: keyof typeof form) => ({
    value: form[key],
    disabled: !canEdit,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm({ ...form, [key]: e.target.value });
      setSaved(false);
    },
  });

  return (
    <section className="drawer-card">
      <h2>Store</h2>

      {!canEdit && <p className="conflict-hint">Only an admin can change these.</p>}

      <div className="form-row">
        <div>
          <label htmlFor="s-name">Name</label>
          <input id="s-name" {...field("name")} />
        </div>
        <div>
          <label htmlFor="s-email">Email</label>
          <input id="s-email" type="email" {...field("email")} placeholder="Shown on receipts" />
        </div>
      </div>

      <div className="form-row">
        <div>
          <label htmlFor="s-currency">Currency</label>
          <input id="s-currency" {...field("currency")} />
        </div>
        <div>
          <label htmlFor="s-tz">Timezone</label>
          <input id="s-tz" {...field("timezone")} />
        </div>
      </div>

      <h3 className="settings-subhead">Tax</h3>
      {/*
        Rates apply to sales rung up from now on. Changing one does not reprice
        anything already sold — a receipt in a customer's hand has to stay true.
      */}
      <p className="conflict-hint">Applies to sales from now on. Nothing already sold is repriced.</p>

      <div className="form-row three">
        <div>
          <label htmlFor="s-tax">Tax %</label>
          <input id="s-tax" inputMode="decimal" {...field("tax_rate")} />
        </div>
        <div>
          <label htmlFor="s-vat">VAT %</label>
          <input id="s-vat" inputMode="decimal" {...field("vat_rate")} />
        </div>
        <div>
          <label htmlFor="s-service">Service %</label>
          <input id="s-service" inputMode="decimal" {...field("service_rate")} />
        </div>
      </div>

      {save.error && (
        <p className="notice notice-error" role="status">
          {save.error instanceof Error ? save.error.message : "Could not save."}
        </p>
      )}
      {saved && <p className="notice notice-ok" role="status">Saved.</p>}

      {canEdit && (
        <button type="button" className="pay-button" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save store settings"}
        </button>
      )}
    </section>
  );
}
