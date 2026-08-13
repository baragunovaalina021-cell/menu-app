const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const db = new Database(path.join(__dirname, 'data', 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  invite_code TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  trial_ends_at INTEGER NOT NULL,
  is_premium INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  name TEXT,
  family_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (family_id) REFERENCES families(id)
);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ingredients TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL, -- 0..6 (Mon..Sun)
  recipe_id TEXT,
  custom_text TEXT,
  FOREIGN KEY (family_id) REFERENCES families(id)
);

CREATE TABLE IF NOT EXISTS shopping_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id TEXT NOT NULL,
  name TEXT NOT NULL,
  qty REAL,
  unit TEXT,
  checked INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual', -- manual | auto
  FOREIGN KEY (family_id) REFERENCES families(id)
);
`);

// Migration: older deployments had a UNIQUE(family_id, day_of_week) constraint
// on menu_entries (one meal per day). Drop it so a day can hold several meals,
// without losing any data already saved by users.
const existingSchema = db.prepare(
  `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'menu_entries'`
).get();
if (existingSchema && existingSchema.sql.includes('UNIQUE(family_id, day_of_week)')) {
  db.exec(`
    ALTER TABLE menu_entries RENAME TO menu_entries_old_v1;
    CREATE TABLE menu_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      recipe_id TEXT,
      custom_text TEXT,
      FOREIGN KEY (family_id) REFERENCES families(id)
    );
    INSERT INTO menu_entries (id, family_id, day_of_week, recipe_id, custom_text)
      SELECT id, family_id, day_of_week, recipe_id, custom_text FROM menu_entries_old_v1;
    DROP TABLE menu_entries_old_v1;
  `);
}

// Seed recipes once
const seedRecipes = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'recipes.json'), 'utf-8'));
const insertRecipe = db.prepare('INSERT OR IGNORE INTO recipes (id, name, ingredients) VALUES (?, ?, ?)');
const seedTx = db.transaction((recipes) => {
  for (const r of recipes) {
    insertRecipe.run(r.id, r.name, JSON.stringify(r.ingredients));
  }
});
seedTx(seedRecipes);

module.exports = db;
