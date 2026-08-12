const express = require('express');
const db = require('../db');
const { requireActiveAccess } = require('../accessGate');

const router = express.Router();

function getFamilyId(req) {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(req.telegramUser.id);
  return user ? user.family_id : null;
}

// List all shopping items (shared across the whole family)
router.get('/', (req, res) => {
  const familyId = getFamilyId(req);
  if (!familyId) return res.status(404).json({ error: 'user_not_found' });
  const items = db
    .prepare('SELECT * FROM shopping_items WHERE family_id = ? ORDER BY checked ASC, id DESC')
    .all(familyId);
  res.json(items);
});

// Add a manual item
router.post('/', requireActiveAccess, (req, res) => {
  const familyId = getFamilyId(req);
  if (!familyId) return res.status(404).json({ error: 'user_not_found' });
  const { name, qty, unit } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name_required' });

  const info = db
    .prepare("INSERT INTO shopping_items (family_id, name, qty, unit, checked, source) VALUES (?, ?, ?, ?, 0, 'manual')")
    .run(familyId, name.trim(), qty || null, unit || null);

  res.json({ id: info.lastInsertRowid });
});

// Toggle checked state
router.patch('/:id', requireActiveAccess, (req, res) => {
  const familyId = getFamilyId(req);
  if (!familyId) return res.status(404).json({ error: 'user_not_found' });
  const { checked } = req.body;
  db.prepare('UPDATE shopping_items SET checked = ? WHERE id = ? AND family_id = ?').run(
    checked ? 1 : 0, req.params.id, familyId
  );
  res.json({ ok: true });
});

// Delete an item
router.delete('/:id', requireActiveAccess, (req, res) => {
  const familyId = getFamilyId(req);
  if (!familyId) return res.status(404).json({ error: 'user_not_found' });
  db.prepare('DELETE FROM shopping_items WHERE id = ? AND family_id = ?').run(req.params.id, familyId);
  res.json({ ok: true });
});

// Clear all checked items
router.post('/clear-checked', requireActiveAccess, (req, res) => {
  const familyId = getFamilyId(req);
  if (!familyId) return res.status(404).json({ error: 'user_not_found' });
  db.prepare('DELETE FROM shopping_items WHERE family_id = ? AND checked = 1').run(familyId);
  res.json({ ok: true });
});

module.exports = router;
