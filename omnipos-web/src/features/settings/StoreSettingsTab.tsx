import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Mail,
  Coins,
  Globe2,
  Percent,
  Receipt,
  Check,
  AlertCircle,
  Calculator,
  ShieldCheck,
  WifiOff,
} from "lucide-react";

import { api } from "@/api/client";
import { formatMoney } from "@/features/pos/cart";
import { useSession } from "@/state/session";
import { useSync } from "@/state/sync";
import { toast } from "@/state/toast";

export interface StoreSettings {
  id: string;
  name: string;
  email: string | null;
  currency: string;
  timezone: string;
  tax_profile: string;
  tax_rate: string;
  vat_rate: string;
  service_rate: string;
}

interface StoreSettingsTabProps {
  settings: StoreSettings;
  canEdit: boolean;
}

export const CURRENCY_OPTIONS = [
  { code: "GHS", label: "GHS — Ghanaian Cedi (GH₵)" },
  { code: "USD", label: "USD — US Dollar ($)" },
  { code: "EUR", label: "EUR — Euro (€)" },
  { code: "GBP", label: "GBP — British Pound (£)" },
  { code: "NGN", label: "NGN — Nigerian Naira (₦)" },
  { code: "KES", label: "KES — Kenyan Shilling (KSh)" },
  { code: "ZAR", label: "ZAR — South African Rand (R)" },
  { code: "CAD", label: "CAD — Canadian Dollar ($)" },
  { code: "AUD", label: "AUD — Australian Dollar ($)" },
  { code: "CNY", label: "CNY — Chinese Yuan (¥)" },
  { code: "INR", label: "INR — Indian Rupee (₹)" },
  { code: "JPY", label: "JPY — Japanese Yen (¥)" },
  { code: "AED", label: "AED — UAE Dirham (د.إ)" },
];

export const TIMEZONE_OPTIONS = [
  { value: "Africa/Accra", label: "Africa/Accra (GMT+0 / GMT)" },
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
  { value: "Africa/Lagos", label: "Africa/Lagos (GMT+1 / WAT)" },
  { value: "Africa/Nairobi", label: "Africa/Nairobi (GMT+3 / EAT)" },
  { value: "Africa/Johannesburg", label: "Africa/Johannesburg (GMT+2 / SAST)" },
  { value: "Africa/Cairo", label: "Africa/Cairo (GMT+2 / EET)" },
  { value: "Africa/Casablanca", label: "Africa/Casablanca (GMT+1 / WEST)" },
  { value: "Europe/London", label: "Europe/London (GMT+0 / BST)" },
  { value: "Europe/Paris", label: "Europe/Paris (CET / CEST)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (CET / CEST)" },
  { value: "America/New_York", label: "America/New_York (EST / EDT)" },
  { value: "America/Chicago", label: "America/Chicago (CST / CDT)" },
  { value: "America/Denver", label: "America/Denver (MST / MDT)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PST / PDT)" },
  { value: "America/Toronto", label: "America/Toronto (EST / EDT)" },
  { value: "America/Sao_Paulo", label: "America/Sao_Paulo (BRT)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GST+4)" },
  { value: "Asia/Riyadh", label: "Asia/Riyadh (AST+3)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (SGT+8)" },
  { value: "Asia/Hong_Kong", label: "Asia/Hong_Kong (HKT+8)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (JST+9)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (AEST / AEDT)" },
];

export function StoreSettingsTab({ settings, canEdit }: StoreSettingsTabProps) {
  const queryClient = useQueryClient();
  const selectStore = useSession((s) => s.selectStore);
  const storeId = useSession((s) => s.storeId);
  const isOnline = useSync((s) => s.online);

  // Cache settings in localStorage for offline availability
  useEffect(() => {
    if (settings && settings.id) {
      localStorage.setItem(`omnipos_store_settings_${settings.id}`, JSON.stringify(settings));
    }
  }, [settings]);

  const [form, setForm] = useState({
    name: settings.name,
    email: settings.email ?? "",
    currency: settings.currency || "GHS",
    timezone: settings.timezone || "Africa/Accra",
    tax_rate: settings.tax_rate ?? "0",
    vat_rate: settings.vat_rate ?? "0",
    service_rate: settings.service_rate ?? "0",
  });

  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api.patch<{ data: StoreSettings }>("/api/store", {
        name: form.name.trim(),
        email: form.email.trim() || null,
        currency: form.currency.trim(),
        timezone: form.timezone.trim(),
        tax_rate: Number(form.tax_rate),
        vat_rate: Number(form.vat_rate),
        service_rate: Number(form.service_rate),
      }),
    onSuccess: async (res) => {
      setSaved(true);
      if (res?.data && res.data.id) {
        localStorage.setItem(`omnipos_store_settings_${res.data.id}`, JSON.stringify(res.data));
      }
      toast.success("Store and tax settings saved successfully.");
      await queryClient.invalidateQueries({ queryKey: ["store-settings"] });
      if (storeId) await selectStore(storeId);
      setTimeout(() => setSaved(false), 4000);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Failed to update store settings.";
      toast.error(msg);
    },
  });

  const field = (key: keyof typeof form) => ({
    value: form[key],
    disabled: !canEdit || save.isPending,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
      setSaved(false);
    },
  });

  // Calculate live breakdown for sample cart using store selected currency
  const curr = form.currency || "GHS";
  const sampleBaseMinor = 100 * 100; // 100.00
  const taxPct = Math.max(0, Number(form.tax_rate) || 0);
  const vatPct = Math.max(0, Number(form.vat_rate) || 0);
  const servicePct = Math.max(0, Number(form.service_rate) || 0);

  const taxAmountMinor = Math.round((sampleBaseMinor * taxPct) / 100);
  const vatAmountMinor = Math.round((sampleBaseMinor * vatPct) / 100);
  const serviceAmountMinor = Math.round((sampleBaseMinor * servicePct) / 100);
  const sampleTotalMinor = sampleBaseMinor + taxAmountMinor + vatAmountMinor + serviceAmountMinor;

  return (
    <div className="settings-tab-pane">
      {!isOnline && (
        <div
          className="action-alert-banner alert-warn-theme"
          role="status"
          style={{ marginBottom: "1rem" }}
        >
          <div className="alert-left-content">
            <WifiOff size={16} />
            <span>
              <strong>Offline Mode:</strong> Store configuration is displayed from local device cache. Settings updates require server reconnection.
            </span>
          </div>
        </div>
      )}

      <div className="settings-card">
        <div className="settings-card-header">
          <div className="settings-title-group">
            <div className="settings-icon-badge">
              <Building2 size={20} aria-hidden="true" />
            </div>
            <div>
              <h2 className="settings-card-heading">Store Profile & Identity</h2>
              <p className="settings-card-subheading">
                Store branding, receipt header information, currency, and local timezone
              </p>
            </div>
          </div>
          {!canEdit && (
            <span className="settings-pill-badge">
              <ShieldCheck size={13} /> Admin Editable Only
            </span>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canEdit && isOnline) save.mutate();
          }}
          className="settings-form-grid"
        >
          {/* Store Name */}
          <div className="settings-field-group">
            <label className="settings-label" htmlFor="s-name">
              Store Name
            </label>
            <div className="settings-input-wrap">
              <span className="settings-input-icon">
                <Building2 size={16} />
              </span>
              <input
                id="s-name"
                className="settings-input has-icon"
                placeholder="Flagship Store"
                required
                {...field("name")}
              />
            </div>
            <span className="settings-field-hint">
              Displayed on till header, customer receipts, and Z-Reports
            </span>
          </div>

          {/* Receipt Email */}
          <div className="settings-field-group">
            <label className="settings-label" htmlFor="s-email">
              Receipt & Support Email
            </label>
            <div className="settings-input-wrap">
              <span className="settings-input-icon">
                <Mail size={16} />
              </span>
              <input
                id="s-email"
                type="email"
                className="settings-input has-icon"
                placeholder="store@domain.com"
                {...field("email")}
              />
            </div>
            <span className="settings-field-hint">
              Printed on the receipt footer for customer inquiries
            </span>
          </div>

          {/* Currency Populated Dropdown List */}
          <div className="settings-field-group">
            <label className="settings-label" htmlFor="s-currency">
              Store Currency Code
            </label>
            <div className="settings-input-wrap">
              <span className="settings-input-icon">
                <Coins size={16} />
              </span>
              <select
                id="s-currency"
                className="settings-input has-icon"
                required
                {...field("currency")}
              >
                {!CURRENCY_OPTIONS.some((c) => c.code === form.currency) && form.currency && (
                  <option value={form.currency}>
                    {form.currency} — Current Configured Currency
                  </option>
                )}
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <span className="settings-field-hint">
              Used for formatting all sales, drawer floats, and profit metrics
            </span>
          </div>

          {/* Timezone Populated Dropdown List */}
          <div className="settings-field-group">
            <label className="settings-label" htmlFor="s-tz">
              Operating Timezone
            </label>
            <div className="settings-input-wrap">
              <span className="settings-input-icon">
                <Globe2 size={16} />
              </span>
              <select
                id="s-tz"
                className="settings-input has-icon"
                required
                {...field("timezone")}
              >
                {!TIMEZONE_OPTIONS.some((tz) => tz.value === form.timezone) && form.timezone && (
                  <option value={form.timezone}>
                    {form.timezone} — Current Configured Timezone
                  </option>
                )}
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>
            <span className="settings-field-hint">
              Determines daily shift boundaries, audit timestamps, and sales reporting
            </span>
          </div>
        </form>
      </div>

      {/* --- Taxes & Levies Section with Interactive Simulator --- */}
      <div className="settings-card" style={{ marginTop: "1.25rem" }}>
        <div className="settings-card-header">
          <div className="settings-title-group">
            <div className="settings-icon-badge" style={{ background: "rgba(22, 163, 74, 0.14)", color: "#16a34a" }}>
              <Percent size={20} aria-hidden="true" />
            </div>
            <div>
              <h2 className="settings-card-heading">Tax, VAT & Service Charges</h2>
              <p className="settings-card-subheading">
                Configure rates applied during checkout. Rates take effect immediately on subsequent orders.
              </p>
            </div>
          </div>
        </div>

        <div className="tax-settings-layout">
          {/* Form Inputs */}
          <div className="settings-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
            <div className="settings-field-group">
              <label className="settings-label" htmlFor="s-tax">
                General Tax %
              </label>
              <div className="settings-input-wrap">
                <input
                  id="s-tax"
                  className="settings-input"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  inputMode="decimal"
                  {...field("tax_rate")}
                />
              </div>
              <span className="settings-field-hint">State or local sales tax</span>
            </div>

            <div className="settings-field-group">
              <label className="settings-label" htmlFor="s-vat">
                VAT %
              </label>
              <div className="settings-input-wrap">
                <input
                  id="s-vat"
                  className="settings-input"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  inputMode="decimal"
                  {...field("vat_rate")}
                />
              </div>
              <span className="settings-field-hint">Value Added Tax</span>
            </div>

            <div className="settings-field-group">
              <label className="settings-label" htmlFor="s-service">
                Service Charge %
              </label>
              <div className="settings-input-wrap">
                <input
                  id="s-service"
                  className="settings-input"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  inputMode="decimal"
                  {...field("service_rate")}
                />
              </div>
              <span className="settings-field-hint">Hospitality or handling fee</span>
            </div>
          </div>

          {/* Interactive Calculator Preview Card using Store Selected Currency */}
          <div className="tax-preview-panel">
            <div className="tax-preview-header">
              <span className="tax-preview-title">
                <Calculator size={16} /> Live Receipt Calculation Simulator
              </span>
              <span className="settings-pill-badge" style={{ fontSize: "0.68rem" }}>
                Sample {formatMoney(sampleBaseMinor, curr)} Cart
              </span>
            </div>

            <div className="tax-preview-receipt">
              <div className="receipt-line">
                <span>Items Subtotal</span>
                <strong>{formatMoney(sampleBaseMinor, curr)}</strong>
              </div>

              {taxPct > 0 && (
                <div className="receipt-line">
                  <span>Tax ({taxPct.toFixed(1)}%)</span>
                  <strong>+{formatMoney(taxAmountMinor, curr)}</strong>
                </div>
              )}

              {vatPct > 0 && (
                <div className="receipt-line">
                  <span>VAT ({vatPct.toFixed(1)}%)</span>
                  <strong>+{formatMoney(vatAmountMinor, curr)}</strong>
                </div>
              )}

              {servicePct > 0 && (
                <div className="receipt-line">
                  <span>Service ({servicePct.toFixed(1)}%)</span>
                  <strong>+{formatMoney(serviceAmountMinor, curr)}</strong>
                </div>
              )}

              {taxPct === 0 && vatPct === 0 && servicePct === 0 && (
                <div className="receipt-line" style={{ fontStyle: "italic", opacity: 0.75 }}>
                  <span>No tax/levies configured</span>
                  <span>{formatMoney(0, curr)}</span>
                </div>
              )}

              <div className="receipt-divider" />

              <div className="receipt-total-line">
                <span>Customer Total</span>
                <span className="receipt-total-val">{formatMoney(sampleTotalMinor, curr)}</span>
              </div>
            </div>
          </div>
        </div>

        {save.error && (
          <div className="action-alert-banner alert-danger-theme" role="status">
            <div className="alert-left-content">
              <AlertCircle size={18} />
              <span>{save.error instanceof Error ? save.error.message : "Could not save settings."}</span>
            </div>
          </div>
        )}

        {saved && (
          <div className="action-alert-banner alert-healthy-theme" role="status">
            <div className="alert-left-content">
              <Check size={18} />
              <span>Settings and tax rates updated. Till register pricing has been refreshed.</span>
            </div>
          </div>
        )}

        {canEdit && (
          <div className="settings-save-bar">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Receipt size={16} className="muted" />
              <small className="muted">Past receipts remain immutable and are not repriced.</small>
            </div>

            <button
              type="button"
              className="settings-btn-primary"
              disabled={save.isPending || !isOnline}
              onClick={() => save.mutate()}
              title={!isOnline ? "Re-connect to internet to save settings" : "Save configuration"}
            >
              {save.isPending ? "Saving changes…" : !isOnline ? "Offline (Read Only)" : "Save Store Configuration"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
