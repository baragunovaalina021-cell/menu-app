const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT id, name, ingredients FROM recipes ORDER BY name').all();
  res.json(rows.map((r) => ({ id: r.id, name: r.name, ingredients: JSON.parse(r.ingredients) })));
});

module.exports = router;
