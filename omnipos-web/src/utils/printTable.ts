type PrintTableInput = {
  title: string;
  columns: string[];
  rows: string[][];
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

export function printTableAsPdf({ title, columns, rows }: PrintTableInput): void {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    window.alert("Allow pop-ups to print or save this report as a PDF.");
    return;
  }

  const headers = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
    <html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>
      @page { size: auto; margin: 16mm; }
      body { color: #172033; font: 12px/1.45 Arial, sans-serif; }
      h1 { margin: 0 0 5px; font-size: 20px; }
      p { margin: 0 0 18px; color: #5b6472; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 8px; border-bottom: 1px solid #d9dee7; text-align: left; vertical-align: top; }
      th { background: #f2f5f9; font-size: 10px; text-transform: uppercase; }
      tr { break-inside: avoid; }
      @media print { thead { display: table-header-group; } }
    </style></head><body>
    <h1>${escapeHtml(title)}</h1><p>${rows.length} records · ${escapeHtml(new Date().toLocaleString())}</p>
    <table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>
    </body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onafterprint = () => printWindow.close();
  window.setTimeout(() => printWindow.print(), 250);
}