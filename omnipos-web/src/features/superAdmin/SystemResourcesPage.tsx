import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, CheckCircle2, Settings, ShieldCheck } from "lucide-react";

import { api } from "@/api/client";
import { useSession } from "@/state/session";

type GlobalCategory = { id: string; name: string; slug: string; status: string; position: number };
type SystemSetting = { key: string; value: Record<string, unknown> | null; description: string | null };
type Resources = { categories: GlobalCategory[]; settings: SystemSetting[] };

export function SystemResourcesPage() {
  const isSuperAdmin = useSession((s) => s.user?.is_super_admin ?? false);
  const queryClient = useQueryClient();
  const [category, setCategory] = useState({ name: "", slug: "", position: "0" });
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [setting, setSetting] = useState({ key: "", value: "{}", description: "" });
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resources = useQuery({
    queryKey: ["admin-system-resources"],
    queryFn: () => api.get<Resources>("/api/admin/system-resources", undefined, { storeless: true }),
    enabled: isSuperAdmin,
  });

  const saveCategory = useMutation({
    mutationFn: () => {
      const payload = {
        name: category.name,
        slug: category.slug,
        position: Number(category.position || 0),
      };

      if (editingCategoryId) {
        return api.patch(`/api/admin/system-resources/categories/${editingCategoryId}`, payload, { storeless: true });
      }

      return api.post("/api/admin/system-resources/categories", payload, { storeless: true });
    },
    onSuccess: () => {
      setCategory({ name: "", slug: "", position: "0" });
      setEditingCategoryId(null);
      setToast(editingCategoryId ? "Category updated." : "Global category created.");
      void queryClient.invalidateQueries({ queryKey: ["admin-system-resources"] });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not save the category."),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/system-resources/categories/${id}`, { storeless: true }),
    onSuccess: () => {
      setToast("Category deleted.");
      void queryClient.invalidateQueries({ queryKey: ["admin-system-resources"] });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not delete the category."),
  });

  const saveSetting = useMutation({
    mutationFn: () => api.patch(`/api/admin/system-resources/settings/${encodeURIComponent(setting.key)}`, { value: JSON.parse(setting.value), description: setting.description || null }, { storeless: true }),
    onSuccess: () => { setToast("System setting saved."); setSetting({ key: "", value: "{}", description: "" }); void queryClient.invalidateQueries({ queryKey: ["admin-system-resources"] }); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not save the setting. Use valid JSON."),
  });

  if (!isSuperAdmin) return <div className="page"><h1><ShieldCheck size={20} /> System Resources</h1><p className="notice notice-warn">This area is limited to platform administrators.</p></div>;

  return (
    <div className="page platform-page">
      <header className="page-header"><div><h1><Boxes size={20} /> System Resources</h1><p className="muted">Global definitions and platform configuration. Store teams decide how they use them.</p></div><span className="platform-scope-badge"><ShieldCheck size={14} /> Platform only</span></header>
      {toast && <p className="platform-toast" role="status"><CheckCircle2 size={16} />{toast}</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}

      <div className="platform-resource-grid">
        <section className="platform-panel"><div className="platform-section-heading"><div><h2>Global Categories</h2><p>Reusable product classifications for stores.</p></div><span className="platform-panel-count">{resources.data?.categories.length ?? 0}</span></div><form className="platform-resource-form" onSubmit={(event) => { event.preventDefault(); saveCategory.mutate(); }}><input placeholder="Category name" value={category.name} onChange={(event) => setCategory({ ...category, name: event.target.value })} required /><input placeholder="slug" value={category.slug} onChange={(event) => setCategory({ ...category, slug: event.target.value })} required /><input type="number" min="0" placeholder="Order" value={category.position} onChange={(event) => setCategory({ ...category, position: event.target.value })} /><button type="submit" className="secondary-button" disabled={saveCategory.isPending}>{editingCategoryId ? "Save" : "Add"}</button>{editingCategoryId && <button type="button" className="secondary-button secondary-button-muted" onClick={() => { setEditingCategoryId(null); setCategory({ name: "", slug: "", position: "0" }); }}>Cancel</button>}</form><div className="platform-resource-list">{resources.data?.categories.map((item) => <div className="platform-resource-row" key={item.id}><span><strong>{item.name}</strong><small>{item.slug} · position {item.position}</small></span><div className="platform-row-actions"><button type="button" className="icon-button" onClick={() => { setEditingCategoryId(item.id); setCategory({ name: item.name, slug: item.slug, position: String(item.position) }); }} aria-label={`Edit ${item.name}`}>Edit</button><button type="button" className="icon-button danger" onClick={() => deleteCategory.mutate(item.id)} aria-label={`Delete ${item.name}`}>Delete</button><b className="platform-status-active">{item.status}</b></div></div>)}</div></section>
        <section className="platform-panel"><div className="platform-section-heading"><div><h2><Settings size={17} /> System Settings</h2><p>Platform-wide key/value configuration.</p></div><span className="platform-panel-count">{resources.data?.settings.length ?? 0}</span></div><form className="platform-resource-form platform-setting-form" onSubmit={(event) => { event.preventDefault(); saveSetting.mutate(); }}><input placeholder="Setting key" value={setting.key} onChange={(event) => setSetting({ ...setting, key: event.target.value })} required /><textarea placeholder='Value JSON, e.g. {"enabled":true}' value={setting.value} onChange={(event) => setSetting({ ...setting, value: event.target.value })} required /><input placeholder="Description" value={setting.description} onChange={(event) => setSetting({ ...setting, description: event.target.value })} /><button type="submit" className="secondary-button" disabled={saveSetting.isPending}>Save setting</button></form><div className="platform-resource-list">{resources.data?.settings.map((item) => <div className="platform-resource-row" key={item.key}><span><strong>{item.key}</strong><small>{item.description ?? "No description"}</small></span><code>{JSON.stringify(item.value ?? {})}</code></div>)}</div></section>
      </div>
    </div>
  );
}
