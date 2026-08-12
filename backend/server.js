const express = require('express');
const cors = require('cors');
const path = require('path');

const { telegramAuth } = require('./auth');
const familyRoutes = require('./routes/family');
const menuRoutes = require('./routes/menu');
const shoppingRoutes = require('./routes/shopping');
const recipesRoutes = require('./routes/recipes');

const app = express();
app.use(cors());
app.use(express.json());

// Serve the Mini App frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use('/api', telegramAuth);
app.use('/api/family', familyRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/shopping', shoppingRoutes);
app.use('/api/recipes', recipesRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Menu app server running on http://localhost:${PORT}`);
  if (!process.env.BOT_TOKEN) {
    console.log('BOT_TOKEN not set — running in DEV mode (X-Debug-User-Id header auth).');
  }
});
