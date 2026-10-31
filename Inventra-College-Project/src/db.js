import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "inventra.sqlite"));
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    business_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sku TEXT NOT NULL COLLATE NOCASE,
    name TEXT NOT NULL,
    variant TEXT NOT NULL DEFAULT '',
    expected_qty INTEGER NOT NULL CHECK(expected_qty >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, sku)
  );

  CREATE INDEX IF NOT EXISTS products_user_name_idx ON products(user_id, name);

  CREATE TABLE IF NOT EXISTS reconciliations (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    count_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS reconciliations_user_date_idx
    ON reconciliations(user_id, count_date DESC, id DESC);

  CREATE TABLE IF NOT EXISTS reconciliation_items (
    id INTEGER PRIMARY KEY,
    reconciliation_id INTEGER NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    sku_snapshot TEXT NOT NULL,
    name_snapshot TEXT NOT NULL,
    variant_snapshot TEXT NOT NULL DEFAULT '',
    expected_qty INTEGER NOT NULL,
    physical_qty INTEGER CHECK(physical_qty IS NULL OR physical_qty >= 0),
    remark TEXT NOT NULL DEFAULT '',
    UNIQUE(reconciliation_id, sku_snapshot)
  );
`);

db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
