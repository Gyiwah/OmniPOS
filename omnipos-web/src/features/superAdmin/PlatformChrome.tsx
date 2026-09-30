import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Search, ShieldCheck, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useSession } from "@/state/session";
import "./superAdmin.css";

export function usePlatformAccess() {
  return useSession((s) => s.user?.is_super_admin ?? false);
}

export function PlatformDenied({ title }: { title: string }) {
  return (
    <div className="page">
      <h1><ShieldCheck size={20} aria-hidden="true" /> {title}</h1>
      <p className="notice notice-warn">This area is limited to platform administrators.</p>
    </div>
  );
}

export function useToast(duration = 3200) {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), duration);
    return () => window.clearTimeout(id);
  }, [toast, duration]);
  return { toast, setToast };
}

export function PlatformToast({ message }: { message: string | null }) {
  if (!message) return null;
  const isError = /could not|failed|invalid|error/i.test(message);
  return (
    <p className={`platform-toast${isError ? " platform-toast-error" : ""}`} role="status">
      <CheckCircle2 size={16} aria-hidden="true" />
      {message}
    </p>
  );
}

export function PlatformPage({
  icon: Icon,
  title,
  description,
  actions,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="page platform-page">
      <header className="page-header platform-page-header">
        <div>
          <p className="platform-eyebrow">Platform control</p>
          <h1><Icon size={22} aria-hidden="true" /> {title}</h1>
          <p className="muted">{description}</p>
        </div>
        <div className="page-actions">
          {actions}
          <span className="platform-scope-badge"><ShieldCheck size={14} aria-hidden="true" /> Super admin</span>
        </div>
      </header>
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "active" || status === "online"
    ? "active"
    : status === "suspended" || status === "pending" || status === "conflict"
      ? "suspended"
      : "inactive";
  return <span className={`platform-status platform-status-${tone}`}>{status.replaceAll("_", " ")}</span>;
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="platform-empty">
      <strong>{title}</strong>
      <p>{hint}</p>
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search-field platform-search">
      <Search size={15} aria-hidden="true" />
      <span className="sr-only">{placeholder}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value && (
        <button type="button" className="search-clear" onClick={() => onChange("")} aria-label="Clear search">
          <X size={14} />
        </button>
      )}
    </label>
  );
}

export function PlatformModal({
  title,
  description,
  onClose,
  children,
  wide,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal platform-members-modal${wide ? " platform-modal-wide" : ""}`}>
        <header className="platform-modal-heading">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="platform-field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
