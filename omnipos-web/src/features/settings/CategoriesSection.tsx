import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { db } from "@/db/schema";
import { useSession } from "@/state/session";

type Category = {
  id: string;
  name: string;
  color: string | null;
  position: number;
};

/**
 * The groupings behind the POS filter chips.
 *
 * Online-only. Categories are a store-wide vocabulary, and two tills inventing
 * "Drinks" while offline would produce two of them with nothing to say which
 * was meant. They are also not on the critical path: a till with no categories
 * still sells everything, it just shows one long list.
 *
 * Deleting one never deletes stock. The foreign key is nullOnDelete, so the
 * products fall back to uncategorised.
 */
export function CategoriesSection() {
  const can = useSession((s) => s.can);
  const storeId = useSession((s) => s.storeId);
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mayManage = can(["admin", "manager"]);

  const categories = useQuery({
    queryKey: ["categories", storeId],
    queryFn: async () => (await api.get<{ data: Category[] }>("/api/categories")).data ?? [],
    enabled: Boolean(storeId) && mayManage,
  });

  /**
   * The POS reads categories from IndexedDB so it works offline, and they do not
   * travel on the changefeed. Without this the chips would keep showing the old
   * set until the next sign-in.
   */
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

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "That did not work.");

  const create = useMutation({
    mutationFn: () => api.post("/api/categories", { name: name.trim(), position: categories.data?.length ?? 0 }),
    onSuccess: async () => {
      setName("");
      setError(null);
      await refresh();
    },
    onError: fail,
  });

  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      api.patch(`/api/categories/${input.id}`, { name: input.name }),
    onSuccess: refresh,
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/categories/${id}`),
    onSuccess: refresh,
    onError: fail,
  });

  if (!mayManage) return null;

  return (
    <section className="drawer-card">
      <h2>Categories</h2>
      <p className="conflict-hint">
        These are the filter chips on the till. Removing one leaves its products uncategorised — it never removes
        stock.
      </p>

      {error && <p className="notice notice-error" role="status">{error}</p>}

      <ul className="tender-list">
        {(categories.data ?? []).map((c) => (
          <li key={c.id}>
            <input
              defaultValue={c.name}
              aria-label={`Name for ${c.name}`}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== c.name) rename.mutate({ id: c.id, name: next });
              }}
            />
            <span />
            <button type="button" className="link danger" onClick={() => remove.mutate(c.id)}>Remove</button>
          </li>
        ))}
      </ul>

      {(categories.data?.length ?? 0) === 0 && <p className="muted">No categories yet.</p>}

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
