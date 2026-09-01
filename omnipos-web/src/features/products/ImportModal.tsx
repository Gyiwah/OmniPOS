import { useState } from "react";
import { AlertTriangle, FileUp } from "lucide-react";

import { db } from "@/db/schema";
import { formatMoney } from "@/features/pos/cart";
import { parseCsv, planImport, summarise, type ImportRow } from "./csvImport";
import { importProducts } from "./service";

type Props = {
  storeId: string;
  currency: string;
  onClose: () => void;
  onImported: () => void;
};

/**
 * Bringing a shop's spreadsheet in.
 *
 * Nothing is written until the whole file has been reviewed. This is usually a
 * shop's first act on the system, with a file from whatever they used before,
 * and an importer that writes as it reads leaves them halfway into a catalogue
 * they cannot judge.
 */
export function ImportModal({ storeId, currency, onClose, onImported }: Props) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; failed: Array<{ line: number; reason: string }> } | null>(null);

  const onFile = async (file: File) => {
    setError(null);
    setResult(null);

    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) {
        setError("That file has no rows under its header.");
        setRows(null);
        return;
      }

      const existing = await db.products.where("store_id").equals(storeId).toArray();
      setRows(planImport(parsed, existing));
      setFileName(file.name);
    } catch {
      setError("That file could not be read as CSV.");
      setRows(null);
    }
  };

  const run = async () => {
    if (!rows) return;

    setBusy(true);
    setError(null);
    try {
      const outcome = await importProducts(storeId, rows, (done, total) => setProgress({ done, total }));
      setResult(outcome);
      setRows(null);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import stopped part way.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const summary = rows ? summarise(rows) : null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Import products from a file">
      <div className="modal modal-wide">
        <h2>Import products</h2>

        {!rows && !result && (
          <>
            <p className="muted">
              A CSV with a header row. Columns are matched by name, so `Product`, `SKU`, `Price`, `Cost`, `Stock`,
              `Barcode` and `Reorder` are all recognised in any order.
            </p>
            <label htmlFor="import-file" className="secondary-button import-drop">
              <FileUp size={18} aria-hidden="true" />
              Choose a CSV file
            </label>
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              className="visually-hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
          </>
        )}

        {error && (
          <p className="notice notice-error" role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        {result && (
          <>
            <p className="notice notice-ok" role="status">
              {result.created} added, {result.updated} updated
              {result.failed.length > 0 && `, ${result.failed.length} failed`}.
            </p>
            {result.failed.length > 0 && (
              <ul className="tender-list">
                {result.failed.map((f) => (
                  <li key={f.line}>
                    <span>Line {f.line}</span>
                    <span className="danger-text">{f.reason}</span>
                    <span />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {rows && summary && (
          <>
            <p className="muted">
              {fileName} · {summary.create} new, {summary.update} to update
              {summary.skip > 0 && `, ${summary.skip} skipped`}
            </p>

            {summary.update > 0 && (
              // The one thing an import must never do quietly.
              <p className="notice notice-warn">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>
                  Existing products keep the stock they already have. A file cannot say whether its stock column is a
                  fresh count or a delivery, and taking it as a total would erase every sale made since the file was
                  exported. Only new products get an opening count.
                </span>
              </p>
            )}

            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr><th>Line</th><th>Name</th><th>SKU</th><th>Price</th><th>Stock</th><th>What happens</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.line} className={row.action === "skip" ? "row-danger" : undefined}>
                      <td className="muted">{row.line}</td>
                      <td>{row.name || <span className="muted">—</span>}</td>
                      <td className="mono">{row.sku}</td>
                      <td>{formatMoney(row.price, currency)}</td>
                      <td>{row.action === "create" ? row.stock : <span className="muted">unchanged</span>}</td>
                      <td>
                        {row.problem ? (
                          <span className="danger-text">{row.problem}</span>
                        ) : row.action === "create" ? (
                          "Add"
                        ) : (
                          "Update"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {progress && (
          <p className="muted" role="status">
            Importing {progress.done} of {progress.total}…
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="link" onClick={onClose}>
            {result ? "Done" : "Cancel"}
          </button>
          {rows && summary && (
            <button
              type="button"
              className="pay-button"
              disabled={busy || summary.create + summary.update === 0}
              onClick={() => void run()}
            >
              {busy ? "Importing…" : `Import ${summary.create + summary.update} products`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
