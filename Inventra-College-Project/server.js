import express from "express";
import helmet from "helmet";
import path from "node:path";
import { createSession, destroySession, hashPassword, requireUser, verifyPassword } from "./src/auth.js";
import { db, PROJECT_ROOT } from "./src/db.js";
import { parseCsv } from "./src/csv.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "3mb" }));
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validDate(value) {
  return typeof value === "string" && ISO_DATE.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function productInput(body = {}) {
  const sku = String(body.sku ?? body.product_id ?? "").trim();
  const name = String(body.name ?? body.product_name ?? "").trim();
  const variant = String(body.variant ?? "").trim();
  const quantity = Number(body.expected_quantity ?? body.expected_qty);
  if (!sku || !name) return { error: "Product ID and name are required." };
  if (sku.length > 60 || name.length > 120 || variant.length > 80) return { error: "Product details are too long." };
  if (!Number.isSafeInteger(quantity) || quantity < 0) return { error: "Expected quantity must be a whole number of zero or more." };
  return { sku, name, variant, quantity };
}

function findOwnedReconciliation(id, userId) {
  return db.prepare("SELECT * FROM reconciliations WHERE id = ? AND user_id = ?").get(id, userId);
}

function reconciliationSummary(id) {
  return db.prepare(`
    SELECT COUNT(*) AS products_checked,
      SUM(CASE WHEN physical_qty IS NOT NULL AND physical_qty = expected_qty THEN 1 ELSE 0 END) AS matched,
      SUM(CASE WHEN physical_qty IS NOT NULL AND physical_qty != expected_qty THEN 1 ELSE 0 END) AS variances,
      SUM(CASE WHEN physical_qty IS NULL THEN 1 ELSE 0 END) AS uncounted
    FROM reconciliation_items WHERE reconciliation_id = ?
  `).get(id);
}

function sendDatabaseError(res, error, conflictMessage = "That product ID is already in your inventory.") {
  if (String(error?.message).includes("UNIQUE constraint failed")) {
    return res.status(409).json({ error: conflictMessage });
  }
  throw error;
}

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const name = String(req.body.name ?? "").trim();
    const businessName = String(req.body.business_name ?? "").trim();
    const email = String(req.body.email ?? "").trim().toLowerCase();
    const password = String(req.body.password ?? "");
    if (!name || !businessName || !email || !password) return res.status(400).json({ error: "Complete every field to create your account." });
    if (name.length > 80 || businessName.length > 120) return res.status(400).json({ error: "Name or business name is too long." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: "Password must contain at least 8 characters." });
    const passwordHash = await hashPassword(password);
    const result = db.prepare("INSERT INTO users (name, business_name, email, password_hash) VALUES (?, ?, ?, ?)")
      .run(name, businessName, email, passwordHash);
    createSession(result.lastInsertRowid, res);
    return res.status(201).json({ user: { id: result.lastInsertRowid, name, business_name: businessName, email } });
  } catch (error) {
    if (String(error?.message).includes("UNIQUE constraint failed")) return res.status(409).json({ error: "An account with this email already exists." });
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body.email ?? "").trim().toLowerCase();
    const password = String(req.body.password ?? "");
    const user = db.prepare("SELECT id, name, business_name, email, password_hash FROM users WHERE email = ?").get(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    createSession(user.id, res);
    return res.json({ user: { id: user.id, name: user.name, business_name: user.business_name, email: user.email } });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

app.get("/api/auth/me", requireUser, (req, res) => res.json({ user: req.user }));

app.patch("/api/profile", requireUser, (req, res, next) => {
  try {
    const name = String(req.body.name ?? "").trim();
    const businessName = String(req.body.business_name ?? "").trim();
    if (!name || !businessName) return res.status(400).json({ error: "Name and business name are required." });
    if (name.length > 80 || businessName.length > 120) return res.status(400).json({ error: "Name or business name is too long." });
    db.prepare("UPDATE users SET name = ?, business_name = ? WHERE id = ?").run(name, businessName, req.user.id);
    res.json({ user: { ...req.user, name, business_name: businessName } });
  } catch (error) {
    next(error);
  }
});

app.get("/api/products", requireUser, (req, res) => {
  const search = String(req.query.q ?? "").trim();
  const rows = search
    ? db.prepare(`SELECT id, sku, name, variant, expected_qty AS expected_quantity
        FROM products WHERE user_id = ? AND (sku LIKE ? OR name LIKE ? OR variant LIKE ?)
        ORDER BY name COLLATE NOCASE`).all(req.user.id, `%${search}%`, `%${search}%`, `%${search}%`)
    : db.prepare(`SELECT id, sku, name, variant, expected_qty AS expected_quantity
        FROM products WHERE user_id = ? ORDER BY name COLLATE NOCASE`).all(req.user.id);
  res.json({ products: rows });
});

app.post("/api/products", requireUser, (req, res, next) => {
  try {
    const input = productInput(req.body);
    if (input.error) return res.status(400).json({ error: input.error });
    const result = db.prepare(`INSERT INTO products (user_id, sku, name, variant, expected_qty)
      VALUES (?, ?, ?, ?, ?)`)
      .run(req.user.id, input.sku, input.name, input.variant, input.quantity);
    res.status(201).json({ product: { id: result.lastInsertRowid, sku: input.sku, name: input.name, variant: input.variant, expected_quantity: input.quantity } });
  } catch (error) {
    if (String(error?.message).includes("UNIQUE constraint failed")) return res.status(409).json({ error: "That product ID already exists in your inventory." });
    next(error);
  }
});

app.put("/api/products/:id", requireUser, (req, res, next) => {
  try {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid product ID." });
    const input = productInput(req.body);
    if (input.error) return res.status(400).json({ error: input.error });
    const result = db.prepare(`UPDATE products SET sku = ?, name = ?, variant = ?, expected_qty = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?`)
      .run(input.sku, input.name, input.variant, input.quantity, id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: "Product not found." });
    res.json({ product: { id, sku: input.sku, name: input.name, variant: input.variant, expected_quantity: input.quantity } });
  } catch (error) {
    if (String(error?.message).includes("UNIQUE constraint failed")) return res.status(409).json({ error: "That product ID already exists in your inventory." });
    next(error);
  }
});

app.delete("/api/products/:id", requireUser, (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid product ID." });
  const result = db.prepare("DELETE FROM products WHERE id = ? AND user_id = ?").run(id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: "Product not found." });
  res.status(204).end();
});

app.post("/api/products/import", requireUser, (req, res, next) => {
  try {
    const products = parseCsv(req.body.csv);
    const findExisting = db.prepare("SELECT id FROM products WHERE user_id = ? AND sku = ?");
    const upsert = db.prepare(`INSERT INTO products (user_id, sku, name, variant, expected_qty)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, sku) DO UPDATE SET name = excluded.name, variant = excluded.variant,
        expected_qty = excluded.expected_qty, updated_at = CURRENT_TIMESTAMP`);
    let added = 0;
    let updated = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const product of products) {
        if (findExisting.get(req.user.id, product.sku)) updated += 1;
        else added += 1;
        upsert.run(req.user.id, product.sku, product.name, product.variant, product.expected_quantity);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.json({ imported: products.length, added, updated });
  } catch (error) {
    if (/CSV|Row |column|quoted field|product/i.test(error.message)) return res.status(400).json({ error: error.message });
    next(error);
  }
});

app.get("/api/dashboard", requireUser, (req, res) => {
  const totalProducts = db.prepare("SELECT COUNT(*) AS count FROM products WHERE user_id = ?").get(req.user.id).count;
  const history = db.prepare(`
    SELECT r.id, r.name, r.count_date, r.status, r.created_at, r.completed_at,
      COUNT(i.id) AS products_checked,
      SUM(CASE WHEN i.physical_qty IS NOT NULL AND i.physical_qty = i.expected_qty THEN 1 ELSE 0 END) AS matched,
      SUM(CASE WHEN i.physical_qty IS NOT NULL AND i.physical_qty != i.expected_qty THEN 1 ELSE 0 END) AS variances,
      SUM(CASE WHEN i.physical_qty IS NULL THEN 1 ELSE 0 END) AS uncounted
    FROM reconciliations r LEFT JOIN reconciliation_items i ON i.reconciliation_id = r.id
    WHERE r.user_id = ? GROUP BY r.id ORDER BY r.count_date DESC, r.id DESC LIMIT 6
  `).all(req.user.id);
  res.json({ total_products: totalProducts, recent_reconciliations: history });
});

app.get("/api/reconciliations", requireUser, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.name, r.count_date, r.status, r.created_at, r.completed_at,
      COUNT(i.id) AS products_checked,
      SUM(CASE WHEN i.physical_qty IS NOT NULL AND i.physical_qty = i.expected_qty THEN 1 ELSE 0 END) AS matched,
      SUM(CASE WHEN i.physical_qty IS NOT NULL AND i.physical_qty != i.expected_qty THEN 1 ELSE 0 END) AS variances,
      SUM(CASE WHEN i.physical_qty IS NULL THEN 1 ELSE 0 END) AS uncounted
    FROM reconciliations r LEFT JOIN reconciliation_items i ON i.reconciliation_id = r.id
    WHERE r.user_id = ? GROUP BY r.id ORDER BY r.count_date DESC, r.id DESC
  `).all(req.user.id);
  res.json({ reconciliations: rows });
});

app.post("/api/reconciliations", requireUser, (req, res) => {
  const name = String(req.body.name ?? "").trim();
  const countDate = String(req.body.count_date ?? "");
  if (!name || name.length > 120) return res.status(400).json({ error: "Enter a reconciliation name up to 120 characters." });
  if (!validDate(countDate)) return res.status(400).json({ error: "Enter a valid reconciliation date." });
  const products = db.prepare("SELECT id, sku, name, variant, expected_qty FROM products WHERE user_id = ? ORDER BY name COLLATE NOCASE").all(req.user.id);
  if (!products.length) return res.status(400).json({ error: "Add at least one product before starting a reconciliation." });
  let result;
  db.exec("BEGIN IMMEDIATE");
  try {
    result = db.prepare("INSERT INTO reconciliations (user_id, name, count_date) VALUES (?, ?, ?)").run(req.user.id, name, countDate);
    const addItem = db.prepare(`INSERT INTO reconciliation_items
      (reconciliation_id, product_id, sku_snapshot, name_snapshot, variant_snapshot, expected_qty)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const product of products) {
      addItem.run(result.lastInsertRowid, product.id, product.sku, product.name, product.variant, product.expected_qty);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  res.status(201).json({ reconciliation: { id: result.lastInsertRowid, name, count_date: countDate, status: "in_progress" } });
});

app.get("/api/reconciliations/:id", requireUser, (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid reconciliation ID." });
  const reconciliation = findOwnedReconciliation(id, req.user.id);
  if (!reconciliation) return res.status(404).json({ error: "Reconciliation not found." });
  const items = db.prepare(`SELECT id, product_id, sku_snapshot AS sku, name_snapshot AS name,
      variant_snapshot AS variant, expected_qty AS expected_quantity, physical_qty AS physical_quantity, remark
    FROM reconciliation_items WHERE reconciliation_id = ? ORDER BY name_snapshot COLLATE NOCASE`).all(id);
  const summary = reconciliationSummary(id);
  const completedItems = items.map((item) => ({
    ...item,
    variance: item.physical_quantity === null ? null : item.physical_quantity - item.expected_quantity,
    status: item.physical_quantity === null ? "Not counted" : item.physical_quantity === item.expected_quantity ? "Matched" : "Requires review"
  }));
  res.json({ reconciliation: { ...reconciliation, summary, items: completedItems } });
});

app.put("/api/reconciliations/:id/items/:itemId", requireUser, (req, res) => {
  const reconciliationId = positiveId(req.params.id);
  const itemId = positiveId(req.params.itemId);
  if (!reconciliationId || !itemId) return res.status(400).json({ error: "Invalid reconciliation or item ID." });
  const reconciliation = findOwnedReconciliation(reconciliationId, req.user.id);
  if (!reconciliation) return res.status(404).json({ error: "Reconciliation not found." });
  if (reconciliation.status !== "in_progress" && Object.hasOwn(req.body, "physical_quantity")) {
    return res.status(409).json({ error: "Counts cannot be changed after a reconciliation is completed." });
  }
  const item = db.prepare("SELECT id FROM reconciliation_items WHERE id = ? AND reconciliation_id = ?").get(itemId, reconciliationId);
  if (!item) return res.status(404).json({ error: "Reconciliation item not found." });
  if (Object.hasOwn(req.body, "physical_quantity")) {
    const quantity = Number(req.body.physical_quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0) return res.status(400).json({ error: "Physical quantity must be a whole number of zero or more." });
    db.prepare("UPDATE reconciliation_items SET physical_qty = ? WHERE id = ?").run(quantity, itemId);
  }
  if (Object.hasOwn(req.body, "remark")) {
    const remark = String(req.body.remark ?? "").trim();
    if (remark.length > 500) return res.status(400).json({ error: "Remark must be 500 characters or fewer." });
    db.prepare("UPDATE reconciliation_items SET remark = ? WHERE id = ?").run(remark, itemId);
  }
  res.json({ ok: true });
});

app.post("/api/reconciliations/:id/complete", requireUser, (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid reconciliation ID." });
  const reconciliation = findOwnedReconciliation(id, req.user.id);
  if (!reconciliation) return res.status(404).json({ error: "Reconciliation not found." });
  if (reconciliation.status === "completed") return res.json({ reconciliation, summary: reconciliationSummary(id) });
  const summary = reconciliationSummary(id);
  if (summary.products_checked === 0 || summary.uncounted > 0) {
    return res.status(409).json({ error: `Count all ${summary.products_checked} products before completing this reconciliation.` });
  }
  db.prepare("UPDATE reconciliations SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
    .run(id, req.user.id);
  res.json({ ok: true, summary: reconciliationSummary(id) });
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
app.get(/.*/, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  if (error?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON request." });
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Inventra is running at http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop the server.");
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
