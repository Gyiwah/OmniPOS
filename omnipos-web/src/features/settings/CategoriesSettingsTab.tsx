import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Tag,
  Plus,
  Pencil,
  Trash2,
  Search,
  Check,
  X,
  Layers,
  Sparkles,
} from "lucide-react";

import { api } from "@/api/client";
import { db } from "@/db/schema";
import { useSession } from "@/state/session";
import { toast } from "@/state/toast";

export type Category = {
  id: string;
  name: string;
  color: string | null;
  position: number;
};

const PALETTE = [
  "#0767de",
  "#fe7403",
  "#16a34a",
  "#8b5cf6",
  "#06b6d4",
  "#f43f5e",
  "#eab308",
  "#14b8a6",
];

export function CategoriesSettingsTab() {
  const can = useSession((s) => s.can);
  const storeId = useSession((s) => s.storeId);
  const queryClient = useQueryClient();

  const [newName, setNewName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editName, setEditName] = useState("");

  const mayManage = can(["admin", "manager"]);

  const categoriesQuery = useQuery({
    queryKey: ["categories", storeId],
    queryFn: async () => (await api.get<{ data: Category[] }>("/api/categories")).data ?? [],
    enabled: Boolean(storeId) && mayManage,
  });

  const syncLocal = async (rows: Category[]) => {
    if (!storeId) return;
    await db.transaction("rw", [db.categories], async () => {
      await db.categories.where("store_id").equals(storeId).delete();
      await db.categories.bulkPut(
        rows.map((c) => ({
          id: c.id,
          store_id: storeId,
          name: c.name,
          color: c.color,
          position: c.position,
        }))
      );
    });
  };

  const refresh = async () => {
    const res = await queryClient.fetchQuery({
      queryKey: ["categories", storeId],
      queryFn: async () => (await api.get<{ data: Category[] }>("/api/categories")).data ?? [],
    });
    await syncLocal(res);
  };

  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : "Action could not be completed.";
    toast.error(msg);
  };

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/categories", {
        name: newName.trim(),
        position: categoriesQuery.data?.length ?? 0,
      }),
    onSuccess: async () => {
      const addedName = newName.trim();
      setNewName("");
      toast.success(`Category "${addedName}" created.`);
      await refresh();
    },
    onError: fail,
  });

  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      api.patch(`/api/categories/${input.id}`, { name: input.name }),
    onSuccess: async () => {
      setEditingCategory(null);
      setEditName("");
      toast.success("Category updated.");
      await refresh();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/categories/${id}`),
    onSuccess: async () => {
      toast.success("Category removed.");
      await refresh();
    },
    onError: fail,
  });

  const rawList = categoriesQuery.data ?? [];

  const filteredCategories = useMemo(() => {
    if (!searchTerm.trim()) return rawList;
    const term = searchTerm.toLowerCase();
    return rawList.filter((c) => c.name.toLowerCase().includes(term));
  }, [rawList, searchTerm]);

  if (!mayManage) return null;

  return (
    <div className="settings-tab-pane">
      <div className="settings-card">
        <div className="settings-card-header">
          <div className="settings-title-group">
            <div className="settings-icon-badge badge-categories">
              <Tag size={20} aria-hidden="true" />
            </div>
            <div>
              <h2 className="settings-card-heading">Catalogue Product Categories</h2>
              <p className="settings-card-subheading">
                Organize catalogue items into quick-tap category filters on the POS till register
              </p>
            </div>
          </div>
          <span className="settings-pill-badge">
            <Layers size={13} /> {rawList.length} Categories Active
          </span>
        </div>

        {/* Toolbar & Filter */}
        <div className="categories-toolbar">
          <div className="category-search-box">
            <Search size={16} />
            <input
              type="text"
              className="settings-input"
              placeholder="Filter categories…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Filter categories"
            />
          </div>

          <form
            className="category-add-bar"
            style={{ flex: 1, minWidth: "16rem" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim() && !create.isPending) {
                create.mutate();
              }
            }}
          >
            <input
              type="text"
              className="settings-input category-add-input"
              placeholder="Add new category (e.g. Beverages, Bakery)…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              aria-label="New category name"
            />
            <button
              type="submit"
              className="settings-btn-primary"
              style={{ padding: "0.55rem 1rem", fontSize: "0.82rem" }}
              disabled={create.isPending || !newName.trim()}
            >
              <Plus size={15} />
              <span>{create.isPending ? "Adding…" : "Add"}</span>
            </button>
          </form>
        </div>

        {/* Category Bento Grid */}
        {categoriesQuery.isLoading ? (
          <p className="muted" style={{ padding: "1rem" }}>
            Loading store categories…
          </p>
        ) : filteredCategories.length === 0 ? (
          <div className="chart-empty-state">
            <Sparkles size={24} className="muted" />
            <strong>No categories found</strong>
            <small className="muted">
              {searchTerm ? "No categories match your search term." : "Create your first category above to begin organizing the POS till."}
            </small>
          </div>
        ) : (
          <div className="category-bento-grid">
            {filteredCategories.map((cat, idx) => {
              const colorDot = cat.color ?? PALETTE[idx % PALETTE.length];

              return (
                <div key={cat.id} className="category-card-tile">
                  <div className="category-tile-left">
                    <span
                      className="category-color-dot"
                      style={{ backgroundColor: colorDot }}
                    />
                    <div className="category-meta-block">
                      <strong className="category-tile-name" title={cat.name}>
                        {cat.name}
                      </strong>
                      <span className="category-tile-order">
                        Order Position #{cat.position + 1}
                      </span>
                    </div>
                  </div>

                  <div className="category-tile-actions">
                    <button
                      type="button"
                      className="category-action-btn"
                      title="Edit Category"
                      onClick={() => {
                        setEditingCategory(cat);
                        setEditName(cat.name);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="category-action-btn btn-danger"
                      title="Delete Category"
                      onClick={() => {
                        if (window.confirm(`Delete category "${cat.name}"? Products in this category will become uncategorized.`)) {
                          remove.mutate(cat.id);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Category Modal */}
      {editingCategory && (
        <div className="modal-backdrop" onClick={() => setEditingCategory(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "1.1rem", fontWeight: 800 }}>Edit Category Name</h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setEditingCategory(null)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (editName.trim() && editName.trim() !== editingCategory.name) {
                  rename.mutate({ id: editingCategory.id, name: editName.trim() });
                }
              }}
              style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "0.5rem" }}
            >
              <div className="settings-field-group">
                <label className="settings-label" htmlFor="edit-cat-name">
                  Category Name
                </label>
                <input
                  id="edit-cat-name"
                  className="settings-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setEditingCategory(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="settings-btn-primary"
                  disabled={rename.isPending || !editName.trim() || editName.trim() === editingCategory.name}
                >
                  <Check size={14} />
                  <span>{rename.isPending ? "Saving…" : "Save Changes"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
