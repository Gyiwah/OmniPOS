import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type LocalCategory, type LocalProduct } from "@/db/schema";
import { toMinor } from "@/features/pos/cart";
import { saveProduct, suggestSku } from "./service";

type Props = {
  storeId: string;
  currency: string;
  product?: LocalProduct;
  onClose: () => void;
  onSaved: (product: LocalProduct) => void;
};

/**
 * Add or edit a product.
 *
 * Stock is absent on purpose. Quantities move only through the ledger, so a new
 * product starts at zero and the opening count is a separate, explicit stock
 * movement — which is also the only way two tills that were both offline can end
 * up agreeing about how many there are.
 */
export function ProductForm({ storeId, currency, product, onClose, onSaved }: Props) {
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [price, setPrice] = useState(product ? product.price : "");
  const [cost, setCost] = useState(product?.cost_price ?? "");
  const [reorder, setReorder] = useState(String(product?.reorder_level ?? 0));
  const [categoryId, setCategoryId] = useState(product?.category_id ?? "");
  const [active, setActive] = useState(product?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const categories = useLiveQuery(
    () => db.categories.where("store_id").equals(storeId).sortBy("position"),
    [storeId],
    [] as LocalCategory[],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const saved = await saveProduct(
        storeId,
        {
          name,
          sku: sku.trim() || suggestSku(name),
          barcode: barcode || null,
          price: toMinor(price),
          costPrice: cost.trim() === "" ? null : toMinor(cost),
          reorderLevel: Number(reorder) || 0,
          categoryId: categoryId || null,
          isActive: active,
        },
        product,
      );
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the product.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={product ? "Edit product" : "Add product"}>
      <form className="modal" onSubmit={submit}>
        <h2>{product ? "Edit product" : "Add product"}</h2>

        <label htmlFor="p-name">Name</label>
        <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />

        <label htmlFor="p-sku">SKU</label>
        <input
          id="p-sku"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          placeholder={name ? suggestSku(name) : "Generated from the name"}
        />

        <label htmlFor="p-barcode">Barcode</label>
        <input id="p-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Optional" />

        <div className="form-row">
          <div>
            <label htmlFor="p-price">Price ({currency})</label>
            <input id="p-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="p-cost">Cost ({currency})</label>
            <input id="p-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="p-reorder">Reorder at</label>
            <input id="p-reorder" type="number" min={0} value={reorder} onChange={(e) => setReorder(e.target.value)} />
          </div>
          <div>
            <label htmlFor="p-category">Category</label>
            <select id="p-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Available to sell
        </label>

        {!product && (
          <p className="conflict-hint">
            New products start at zero stock. Record what you have with "Adjust stock" once it is saved — quantities
            move through the ledger, which is what keeps two tills in agreement.
          </p>
        )}

        {error && <p className="notice notice-error" role="status">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="link" onClick={onClose}>Cancel</button>
          <button type="submit" className="pay-button" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
