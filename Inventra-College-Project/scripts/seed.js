import { db } from "../src/db.js";
import { hashPassword } from "../src/auth.js";

const email = "demo@inventra.local";
const sampleProducts = [
  ["HW001", "PVC Connector", "20mm", 120],
  ["EL024", "Switch", "16A", 80],
  ["SP102", "Bearing", "6204", 50],
  ["EL031", "Copper Cable", "2.5mm", 75],
  ["PL014", "Water Tap", "Brass", 32]
];

const passwordHash = await hashPassword("InventraDemo2026!");
let user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
if (user) {
  db.prepare("UPDATE users SET name = ?, business_name = ?, password_hash = ? WHERE id = ?")
    .run("Demo Owner", "Inventra Demo Hardware", passwordHash, user.id);
} else {
  const result = db.prepare("INSERT INTO users (name, business_name, email, password_hash) VALUES (?, ?, ?, ?)")
    .run("Demo Owner", "Inventra Demo Hardware", email, passwordHash);
  user = { id: result.lastInsertRowid };
}

// Re-running the seed resets only the reserved demo account's sample records.
db.prepare("DELETE FROM reconciliations WHERE user_id = ?").run(user.id);
db.prepare("DELETE FROM products WHERE user_id = ?").run(user.id);
const addProduct = db.prepare("INSERT INTO products (user_id, sku, name, variant, expected_qty) VALUES (?, ?, ?, ?, ?)");
for (const [sku, name, variant, quantity] of sampleProducts) {
  addProduct.run(user.id, sku, name, variant, quantity);
}

const date = new Date().toISOString().slice(0, 10);
const reconciliation = db.prepare(`
  INSERT INTO reconciliations (user_id, name, count_date, status, completed_at)
  VALUES (?, ?, ?, 'completed', CURRENT_TIMESTAMP)
`).run(user.id, "Demo Stock Check", date);
const addItem = db.prepare(`
  INSERT INTO reconciliation_items
    (reconciliation_id, product_id, sku_snapshot, name_snapshot, variant_snapshot, expected_qty, physical_qty, remark)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const countedQuantities = [120, 76, 50, 75, 29];
const products = db.prepare("SELECT id, sku, name, variant, expected_qty FROM products WHERE user_id = ? ORDER BY id").all(user.id);
products.forEach((product, index) => {
  const physical = countedQuantities[index];
  const remark = physical === product.expected_qty ? "" : "Recount required";
  addItem.run(reconciliation.lastInsertRowid, product.id, product.sku, product.name, product.variant, product.expected_qty, physical, remark);
});

console.log("Demo account and sample stock are ready.");
console.log(`Email: ${email}`);
console.log("Password: InventraDemo2026!");
