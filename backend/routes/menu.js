const express = require('express');
const db = require('../db');
const { requireActiveAccess } = require('../accessGate');

const router = express.Router();

const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

function getFamilyId(req) {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(req.telegramUser.id);
  return user ? user.family_id : null;
}

function hydrateEntry(e) {
  let recipe = null;
  if (e.recipe_id) {
    const r = db.prepare('SELECT id, name, ingredients FROM recipes WHERE id = ?').get(e.recipe_id);
    if (r) recipe = { id: r.id, name: r.name, ingredients: JSON.parse(r.ingredients) };
  }
  return {
    id: e.id,
    recipeId: e.recipe_id,
    recipe,
    customText: e.custom_text,
  };
}

// GET weekly menu — each day now holds a LIST of meals, not just one
router.get('/', (req, res) => {
  const familyId = getFamilyId(req);
  if (!familyId) return res.status(404).json({ error: 'user_not_found' });

  const entries = db
    .prepare('SELECT * FROM menu_entries WHERE family_id = ? ORDER BY id ASC')
    .all(familyId);

  const byDay = {};
  for (const e of entries) {
    if (!byDay[e.day_of_week]) byDay[e.day_of_week] = [];
    byDay[e.day_of_week].push(hydrateEntry(e));
  }

  const week = DAY_NAMES.map((name, day) => ({
    day,
    dayName: name,
    meals: byDay[day] || [],
  }));

  res.json(week);
});

// Regenerate the auto shopping list from the current week's recipes
// (registered before the '/:day' route below so "generate-shopping-list"
// is never swallowed as if it were a day number)
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

// Add a meal to a day (recipe from library OR free-text)
router.post('/:day', requireActiveAccess, (req, res) => {
  const familyId = getFamilyId(req);
  if (!familyId) return res.status(404).json({ error: 'user_not_found' });

  const day = Number(req.params.day);
  if (!Number.isInteger(day) || day < 0 || day > 6) {
    return res.status(400).json({ error: 'invalid_day' });
  }

  const { recipeId, customText } = req.body;
  if (!recipeId && !customText) {
    return res.status(400).json({ error: 'recipe_or_text_required' });
  }

  const info = db
    .prepare('INSERT INTO menu_entries (family_id, day_of_week, recipe_id, custom_text) VALUES (?, ?, ?, ?)')
    .run(familyId, day, recipeId || null, customText || null);

  res.json({ ok: true, id: info.lastInsertRowid });
});

// Remove a single meal by its entry id
router.delete('/entry/:entryId', requireActiveAccess, (req, res) => {
  const familyId = getFamilyId(req);
  if (!familyId) return res.status(404).json({ error: 'user_not_found' });
  db.prepare('DELETE FROM menu_entries WHERE id = ? AND family_id = ?').run(req.params.entryId, familyId);
  res.json({ ok: true });
});

// Clear every meal on a given day
router.delete('/:day', requireActiveAccess, (req, res) => {
  const familyId = getFamilyId(req);
  if (!familyId) return res.status(404).json({ error: 'user_not_found' });
  const day = Number(req.params.day);
  db.prepare('DELETE FROM menu_entries WHERE family_id = ? AND day_of_week = ?').run(familyId, day);
  res.json({ ok: true });
});

module.exports = router;
