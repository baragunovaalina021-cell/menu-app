const express = require('express');
const db = require('../db');
const { requireActiveAccess } = require('../accessGate');

const router = express.Router();

const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

function getFamilyId(req) {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(req.telegramUser.id);
  return user ? user.family_id : null;
}

// GET weekly menu
router.get('/', (req, res) => {
  const familyId = getFamilyId(req);
  if (!familyId) return res.status(404).json({ error: 'user_not_found' });

  const entries = db.prepare('SELECT * FROM menu_entries WHERE family_id = ?').all(familyId);
  const byDay = {};
  for (const e of entries) byDay[e.day_of_week] = e;

  const week = DAY_NAMES.map((name, day) => {
    const entry = byDay[day];
    let recipe = null;
    if (entry && entry.recipe_id) {
      const r = db.prepare('SELECT id, name, ingredients FROM recipes WHERE id = ?').get(entry.recipe_id);
      if (r) recipe = { id: r.id, name: r.name, ingredients: JSON.parse(r.ingredients) };
    }
    return {
      day,
      dayName: name,
      recipeId: entry ? entry.recipe_id : null,
      recipe,
      customText: entry ? entry.custom_text : null,
    };
  });

  res.json(week);
});

// Set a day's meal (recipe from library OR free-text)
router.put('/:day', requireActiveAccess, (req, res) => {
  const familyId = getFamilyId(req);
  if (!familyId) return res.status(404).json({ error: 'user_not_found' });

  const day = Number(req.params.day);
  if (!Number.isInteger(day) || day < 0 || day > 6) {
    return res.status(400).json({ error: 'invalid_day' });
  }

  const { recipeId, customText } = req.body;

  db.prepare(
    `INSERT INTO menu_entries (family_id, day_of_week, recipe_id, custom_text)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(family_id, day_of_week) DO UPDATE SET recipe_id = excluded.recipe_id, custom_text = excluded.custom_text`
  ).run(familyId, day, recipeId || null, customText || null);

  res.json({ ok: true });
});

// Clear a day
router.delete('/:day', requireActiveAccess, (req, res) => {
  const familyId = getFamilyId(req);
  if (!familyId) return res.status(404).json({ error: 'user_not_found' });
  const day = Number(req.params.day);
  db.prepare('DELETE FROM menu_entries WHERE family_id = ? AND day_of_week = ?').run(familyId, day);
  res.json({ ok: true });
});

// Regenerate the auto shopping list from the current week's recipes
router.post('/generate-shopping-list', requireActiveAccess, (req, res) => {
  const familyId = getFamilyId(req);
  if (!familyId) return res.status(404).json({ error: 'user_not_found' });

  const entries = db.prepare('SELECT * FROM menu_entries WHERE family_id = ? AND recipe_id IS NOT NULL').all(familyId);

  const aggregated = new Map(); // key: name|unit -> qty
  for (const e of entries) {
    const r = db.prepare('SELECT ingredients FROM recipes WHERE id = ?').get(e.recipe_id);
    if (!r) continue;
    const ingredients = JSON.parse(r.ingredients);
    for (const ing of ingredients) {
      const key = `${ing.name}|${ing.unit || ''}`;
      const prev = aggregated.get(key) || 0;
      aggregated.set(key, prev + (Number(ing.qty) || 0));
    }
  }

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM shopping_items WHERE family_id = ? AND source = 'auto'").run(familyId);
    const insert = db.prepare(
      "INSERT INTO shopping_items (family_id, name, qty, unit, checked, source) VALUES (?, ?, ?, ?, 0, 'auto')"
    );
    for (const [key, qty] of aggregated.entries()) {
      const [name, unit] = key.split('|');
      insert.run(familyId, name, qty, unit || null);
    }
  });
  tx();

  res.json({ ok: true, itemsGenerated: aggregated.size });
});

module.exports = router;
