export function parseCsv(text) {
  if (typeof text !== "string" || text.length > 2_000_000) {
    throw new Error("CSV file is empty or larger than 2 MB.");
  }
  const source = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("A quoted field is missing its closing quote.");
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  if (rows.length < 2) throw new Error("Add a header row and at least one product.");

  const headers = rows[0].map((cell) => cell.trim().toLowerCase());
  const column = (names) => headers.findIndex((header) => names.includes(header));
  const skuIndex = column(["product_id", "sku"]);
  const nameIndex = column(["product_name", "name"]);
  const variantIndex = column(["variant"]);
  const quantityIndex = column(["expected_quantity", "expected_qty"]);
  if (skuIndex < 0 || nameIndex < 0 || quantityIndex < 0) {
    throw new Error("Required columns: product_id, product_name and expected_quantity.");
  }

  const seen = new Set();
  const products = rows.slice(1).map((cells, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const sku = (cells[skuIndex] ?? "").trim();
    const name = (cells[nameIndex] ?? "").trim();
    const variant = variantIndex < 0 ? "" : (cells[variantIndex] ?? "").trim();
    const quantityText = (cells[quantityIndex] ?? "").trim();
    const quantity = Number(quantityText);
    if (!sku || !name) throw new Error(`Row ${rowNumber}: product ID and name are required.`);
    if (sku.length > 60 || name.length > 120 || variant.length > 80) {
      throw new Error(`Row ${rowNumber}: a product field is too long.`);
    }
    if (!/^\d+$/.test(quantityText) || !Number.isSafeInteger(quantity) || quantity < 0) {
      throw new Error(`Row ${rowNumber}: expected quantity must be a whole number of zero or more.`);
    }
    const normalizedSku = sku.toLocaleLowerCase();
    if (seen.has(normalizedSku)) throw new Error(`Row ${rowNumber}: duplicate product ID ${sku} in this file.`);
    seen.add(normalizedSku);
    return { sku, name, variant, expected_quantity: quantity };
  });
  return products;
}
