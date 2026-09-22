import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { db } from "@/db/schema";
import { useSession } from "@/state/session";
import { toast } from "@/state/toast";

type Category = {
  id: string;
  name: string;
  color: string | null;
  position: number;
};

export function CategoriesSection() {
  const can = useSession((s) => s.can);
  const storeId = useSession((s) => s.storeId);
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mayManage = can(["admin", "manager"]);

  const categories = useQuery({
    queryKey: ["categories", storeId],
    queryFn: async () => (await api.get<{ data: Category[] }>("/api/categories")).data ?? [],
    enabled: Boolean(storeId) && mayManage,
  });

  const syncLocal = async (rows: Category[]) => {
    if (!storeId) return;
    await db.transaction("rw", [db.categories], async () => {
      await db.categories.where("store_id").equals(storeId).delete();
      await db.categories.bulkPut(
        rows.map((c) => ({ id: c.id, store_id: storeId, name: c.name, color: c.color, position: c.position })),
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
    const msg = e instanceof Error ? e.message : "That did not work.";
    setError(msg);
    toast.error(msg);
  };

  const create = useMutation({
    mutationFn: () => api.post("/api/categories", { name: name.trim(), position: categories.data?.length ?? 0 }),
    onSuccess: async () => {
      const addedName = name.trim();
      setName("");
      setError(null);
      toast.success(`Category "${addedName}" created.`);
      await refresh();
    },
    onError: fail,
  });

  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      api.patch(`/api/categories/${input.id}`, { name: input.name }),
    onSuccess: async () => {
      toast.success("Category updated.");
      await refresh();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/categories/${id}`),
    onSuccess: async () => {
      setSelectedId("");
      setEditName("");
      toast.success("Category removed.");
      await refresh();
    },
    onError: fail,
  });

  if (!mayManage) return null;

  const categoryList = categories.data ?? [];
  const selectedCategory = categoryList.find((c) => c.id === selectedId);

  const handleSelectCategory = (id: string) => {
    setSelectedId(id);
    const cat = categoryList.find((c) => c.id === id);
    setEditName(cat ? cat.name : "");
  };

  return (
    <section className="drawer-card">
      <h2>Categories</h2>
      <p className="conflict-hint">
        Categories group products on the till. Select a category from the drop-down list to edit or remove it.
      </p>

      {error && <p className="notice notice-error" role="status">{error}</p>}

      <div className="drawer-movement" style={{ marginBottom: "1rem" }}>
        <select
          value={selectedId}
          onChange={(e) => handleSelectCategory(e.target.value)}
          aria-label="Select category"
        >
          <option value="">-- Select a Category ({categoryList.length}) --</option>
          {categoryList.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {selectedCategory && (
        <div className="category-edit-card" style={{ padding: "0.85rem", background: "var(--panel-2)", borderRadius: "var(--radius-sm)", marginBottom: "1.2rem" }}>
          <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--muted)" }}>Edit Category Name</label>
          <div className="drawer-movement" style={{ marginTop: "0.4rem" }}>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              aria-label="Category name"
            />
            <button
              type="button"
              className="secondary-button"
              disabled={rename.isPending || !editName.trim() || editName.trim() === selectedCategory.name}
              onClick={() => rename.mutate({ id: selectedCategory.id, name: editName.trim() })}
            >
              Save
            </button>
            <button
              type="button"
              className="icon-button danger"
              onClick={() => {
                if (window.confirm(`Delete category "${selectedCategory.name}"?`)) {
                  remove.mutate(selectedCategory.id);
                }
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}

      <h3 className="settings-subhead">Add new category</h3>
      <form
        className="drawer-movement"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Drinks, Bakery, Household…"
          aria-label="New category name"
        />
        <button type="submit" className="secondary-button" disabled={create.isPending || !name.trim()}>
          {create.isPending ? "Adding…" : "Add category"}
        </button>
      </form>
    </section>
  );
}

