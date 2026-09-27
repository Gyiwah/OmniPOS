import { useState } from "react";
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
} from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";
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

export function StoreSettingsTab({ settings, canEdit }: StoreSettingsTabProps) {
  const queryClient = useQueryClient();
  const selectStore = useSession((s) => s.selectStore);
  const storeId = useSession((s) => s.storeId);

  const [form, setForm] = useState({
    name: settings.name,
    email: settings.email ?? "",
    currency: settings.currency,
    timezone: settings.timezone,
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
    onSuccess: async () => {
      setSaved(true);
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

  // Calculate live breakdown for sample $100 sale
  const sampleBase = 100;
  const taxPct = Math.max(0, Number(form.tax_rate) || 0);
  const vatPct = Math.max(0, Number(form.vat_rate) || 0);
  const servicePct = Math.max(0, Number(form.service_rate) || 0);

  const taxAmount = (sampleBase * taxPct) / 100;
  const vatAmount = (sampleBase * vatPct) / 100;
  const serviceAmount = (sampleBase * servicePct) / 100;
  const sampleTotal = sampleBase + taxAmount + vatAmount + serviceAmount;

  return (
    <div className="settings-tab-pane">
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
            if (canEdit) save.mutate();
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

          {/* Currency */}
          <div className="settings-field-group">
            <label className="settings-label" htmlFor="s-currency">
              Store Currency Code
            </label>
            <div className="settings-input-wrap">
              <span className="settings-input-icon">
                <Coins size={16} />
              </span>
              <input
                id="s-currency"
                className="settings-input has-icon"
                placeholder="USD, GHS, EUR, GBP…"
                maxLength={5}
                required
                {...field("currency")}
              />
            </div>
            <span className="settings-field-hint">
              Used for formatting all sales, drawer floats, and profit metrics
            </span>
          </div>

          {/* Timezone */}
          <div className="settings-field-group">
            <label className="settings-label" htmlFor="s-tz">
              Operating Timezone
            </label>
            <div className="settings-input-wrap">
              <span className="settings-input-icon">
                <Globe2 size={16} />
              </span>
              <input
                id="s-tz"
                className="settings-input has-icon"
                placeholder="UTC, Africa/Accra, America/New_York…"
                required
                {...field("timezone")}
              />
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

          {/* Interactive Calculator Preview Card */}
          <div className="tax-preview-panel">
            <div className="tax-preview-header">
              <span className="tax-preview-title">
                <Calculator size={16} /> Live Receipt Calculation Simulator
              </span>
              <span className="settings-pill-badge" style={{ fontSize: "0.68rem" }}>
                Sample ${sampleBase} Cart
              </span>
            </div>

            <div className="tax-preview-receipt">
              <div className="receipt-line">
                <span>Items Subtotal</span>
                <strong>${sampleBase.toFixed(2)}</strong>
              </div>

              {taxPct > 0 && (
                <div className="receipt-line">
                  <span>Tax ({taxPct.toFixed(1)}%)</span>
                  <strong>+${taxAmount.toFixed(2)}</strong>
                </div>
              )}

              {vatPct > 0 && (
                <div className="receipt-line">
                  <span>VAT ({vatPct.toFixed(1)}%)</span>
                  <strong>+${vatAmount.toFixed(2)}</strong>
                </div>
              )}

              {servicePct > 0 && (
                <div className="receipt-line">
                  <span>Service ({servicePct.toFixed(1)}%)</span>
                  <strong>+${serviceAmount.toFixed(2)}</strong>
                </div>
              )}

              {taxPct === 0 && vatPct === 0 && servicePct === 0 && (
                <div className="receipt-line" style={{ fontStyle: "italic", opacity: 0.75 }}>
                  <span>No tax/levies configured</span>
                  <span>$0.00</span>
                </div>
              )}

              <div className="receipt-divider" />

              <div className="receipt-total-line">
                <span>Customer Total</span>
                <span className="receipt-total-val">${sampleTotal.toFixed(2)}</span>
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
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving changes…" : "Save Store Configuration"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
