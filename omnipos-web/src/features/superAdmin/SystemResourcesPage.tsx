import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Plus } from "lucide-react";

import { api } from "@/api/client";
import {
  EmptyState,
  Field,
  PlatformDenied,
  PlatformModal,
  PlatformPage,
  PlatformToast,
  SearchField,
  StatusBadge,
  usePlatformAccess,
  useToast,
} from "./PlatformChrome";

type GlobalCategory = { id: string; name: string; slug: string; status: string; position: number };
type SystemSetting = { key: string; value: Record<string, unknown> | null; description: string | null };
type Resources = { categories: GlobalCategory[]; settings: SystemSetting[] };

const emptyCategory = { name: "", slug: "", position: "0" };

export function SystemResourcesPage() {
  const isSuperAdmin = usePlatformAccess();
  const queryClient = useQueryClient();
  const { toast, setToast } = useToast();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [category, setCategory] = useState(emptyCategory);

  const resources = useQuery({
    queryKey: ["admin-system-resources"],
    queryFn: () => api.get<Resources>("/api/admin/system-resources", undefined, { storeless: true }),
    enabled: isSuperAdmin,
  });

  const saveCategory = useMutation({
    mutationFn: () => {
      const payload = { name: category.name, slug: category.slug, position: Number(category.position || 0) };
      if (editingId) return api.patch(`/api/admin/system-resources/categories/${editingId}`, payload, { storeless: true });
      return api.post("/api/admin/system-resources/categories", payload, { storeless: true });
    },
    onSuccess: () => {
      setCategory(emptyCategory);
      setEditingId(null);
      setOpen(false);
      setToast(editingId ? "Category updated." : "Global category created.");
      void queryClient.invalidateQueries({ queryKey: ["admin-system-resources"] });
    },
    onError: (cause) => setToast(cause instanceof Error ? cause.message : "Could not save the category."),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/system-resources/categories/${id}`, { storeless: true }),
    onSuccess: () => {
      setToast("Category deleted.");
      void queryClient.invalidateQueries({ queryKey: ["admin-system-resources"] });
    },
    onError: (cause) => setToast(cause instanceof Error ? cause.message : "Could not delete the category."),
  });

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (resources.data?.categories ?? []).filter((item) => `${item.name} ${item.slug}`.toLowerCase().includes(needle));
  }, [resources.data, query]);

  if (!isSuperAdmin) return <PlatformDenied title="Catalogues" />;

  return (
    <PlatformPage
      icon={Boxes}
      title="Global catalogues"
      description="Shared product classifications every store can adopt. Store teams still decide which ones they use."
      actions={
        <button type="button" className="pay-button" onClick={() => { setEditingId(null); setCategory(emptyCategory); setOpen(true); }}>
          <Plus size={16} /> Add category
        </button>
      }
    >
      <PlatformToast message={toast} />
      <section className="platform-panel">
        <div className="platform-toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Search categories" />
          <span className="platform-panel-count">{rows.length}</span>
        </div>
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Slug</th><th>Order</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td className="mono">{item.slug}</td>
                <td>{item.position}</td>
                <td><StatusBadge status={item.status} /></td>
                <td className="platform-row-actions">
                  <button type="button" className="icon-button" onClick={() => {
                    setEditingId(item.id);
                    setCategory({ name: item.name, slug: item.slug, position: String(item.position) });
                    setOpen(true);
                  }}>Edit</button>
                  <button type="button" className="icon-button danger-button" onClick={() => {
                    if (window.confirm(`Delete ${item.name}?`)) deleteCategory.mutate(item.id);
                  }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {resources.isLoading && <p className="muted">Loading catalogues…</p>}
        {!resources.isLoading && rows.length === 0 && <EmptyState title="No global categories" hint="Add a reusable classification for stores to pick up." />}
      </section>

      {open && (
        <PlatformModal title={editingId ? "Edit category" : "New category"} onClose={() => setOpen(false)}>
          <form className="platform-form" onSubmit={(e) => { e.preventDefault(); saveCategory.mutate(); }}>
            <Field id="cat-name" label="Name">
              <input id="cat-name" value={category.name} onChange={(e) => setCategory({ ...category, name: e.target.value })} required />
            </Field>
            <Field id="cat-slug" label="Slug">
              <input id="cat-slug" value={category.slug} onChange={(e) => setCategory({ ...category, slug: e.target.value })} required />
            </Field>
            <Field id="cat-pos" label="Display order">
              <input id="cat-pos" type="number" min="0" value={category.position} onChange={(e) => setCategory({ ...category, position: e.target.value })} />
            </Field>
            <div className="platform-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="pay-button" disabled={saveCategory.isPending}>Save</button>
            </div>
          </form>
        </PlatformModal>
      )}
    </PlatformPage>
  );
}
