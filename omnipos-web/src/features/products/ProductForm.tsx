import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db, type LocalCategory, type LocalProduct } from "@/db/schema";
import { toMinor } from "@/features/pos/cart";
import { uploadProductImage } from "./imageUpload";
import { addBatch, adjustStock, recordPriceChange, saveProduct, suggestSku } from "./service";

type Props = {
  storeId: string;
  currency: string;
  product?: LocalProduct;
  onClose: () => void;
  onSaved: (product: LocalProduct) => void;
};

/** Add or edit a product, including an optional ledger-backed opening count. */
export function ProductForm({ storeId, currency, product, onClose, onSaved }: Props) {
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [price, setPrice] = useState(product ? product.price : "");
  const [cost, setCost] = useState(product?.cost_price ?? "");
  const [reorder, setReorder] = useState(String(product?.reorder_level ?? 5));
  const [initialStock, setInitialStock] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [categoryId, setCategoryId] = useState(product?.category_id ?? "");
  const [active, setActive] = useState(product?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState(product?.image_url ?? null);
  const [tags, setTags] = useState((product?.tags ?? []).join(", "));
  const [priceReason, setPriceReason] = useState("");

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
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        },
        product,
      );

      // Recorded after the save and only when something actually moved. A
      // product only ever shows what it costs now, so without this "it has
      // always been twelve" is a claim nobody can check — and that is exactly
      // the claim made when a customer disputes a price.
      if (product) {
        await recordPriceChange({
          storeId,
          productId: saved.id,
          oldPrice: toMinor(product.price),
          newPrice: toMinor(price),
          oldCost: product.cost_price === null ? null : toMinor(product.cost_price),
          newCost: cost.trim() === "" ? null : toMinor(cost),
          reason: priceReason,
        });
      }

      if (!product && Number(initialStock) > 0) {
        const quantity = Math.floor(Number(initialStock));
        if (batchNumber.trim() || expiryDate) {
          await addBatch({
            storeId,
            productId: saved.id,
            batchNumber: batchNumber.trim() || null,
            quantity,
            costPrice: cost.trim() === "" ? null : toMinor(cost),
            expiryDate: expiryDate || null,
            addToStock: true,
          });
        } else {
          await adjustStock({
            storeId,
            productId: saved.id,
            delta: quantity,
            type: "STOCK_IN",
            reason: "Initial stock on creation",
          });
        }
      }
      // Uploaded after the save, because the server files it under the
      // product's id and a new product does not have one until it exists. A
      // failure here is reported but does not undo the save — the product is
      // real, it simply has no picture yet.
      if (image) {
        try {
          setImageUrl(await uploadProductImage({ storeId, productId: saved.id, file: image }));
        } catch (uploadError) {
          setError(uploadError instanceof Error ? uploadError.message : "Saved, but the image did not upload.");
          setBusy(false);
          return;
        }
      }

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

        {!product && (
          <div className="form-row">
            <div>
              <label htmlFor="p-initial-stock">Initial stock</label>
              <input
                id="p-initial-stock"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={initialStock}
                onChange={(e) => setInitialStock(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <label htmlFor="p-batch">Batch / lot number</label>
              <input
                id="p-batch"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
        )}

        {!product && (
          <label htmlFor="p-expiry">Expiry date</label>
        )}
        {!product && (
          <input
            id="p-expiry"
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
          />
        )}

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

        <label htmlFor="p-tags">Tags</label>
        <input
          id="p-tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Comma separated, e.g. chilled, promo"
        />

        {/* Only offered on an edit whose price actually moved: asking why a
            brand-new product costs what it costs is noise. */}
        {product && toMinor(price) !== toMinor(product.price) && (
          <>
            <label htmlFor="p-price-reason">Why is the price changing?</label>
            <input
              id="p-price-reason"
              value={priceReason}
              onChange={(e) => setPriceReason(e.target.value)}
              placeholder="Supplier increase, promotion, correction…"
            />
          </>
        )}

        <label htmlFor="p-image">Picture</label>
        <input
          id="p-image"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(e) => setImage(e.target.files?.[0] ?? null)}
        />
        {image ? (
          <p className="muted">{image.name} will be uploaded when you save.</p>
        ) : imageUrl ? (
          <p className="muted">Has a picture. Choosing a new one replaces it.</p>
        ) : null}

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
