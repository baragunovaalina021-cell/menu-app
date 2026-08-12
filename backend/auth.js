const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN || '';

/**
 * Verifies Telegram WebApp initData signature.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function verifyInitData(initData) {
  if (!BOT_TOKEN) return null; // dev mode, signature check skipped upstream
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  const userJson = params.get('user');
  if (!userJson) return null;
  return JSON.parse(userJson);
}

/**
 * Auth middleware.
 * Production: expects header `X-Telegram-Init-Data` set by the Mini App frontend
 * (window.Telegram.WebApp.initData), verified against BOT_TOKEN.
 * Dev mode (no BOT_TOKEN set): falls back to `X-Debug-User-Id` / `X-Debug-User-Name`
 * headers so the app can be tested without a real Telegram bot.
 */
function telegramAuth(req, res, next) {
  const initData = req.header('X-Telegram-Init-Data');

  if (BOT_TOKEN && initData) {
    const user = verifyInitData(initData);
    if (!user) return res.status(401).json({ error: 'invalid_init_data' });
    req.telegramUser = { id: String(user.id), name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Без имени' };
    return next();
  }

  // Dev fallback
  const debugId = req.header('X-Debug-User-Id');
  const rawDebugName = req.header('X-Debug-User-Name');
  if (debugId) {
    let debugName = 'Тестовый пользователь';
    if (rawDebugName) {
      try { debugName = decodeURIComponent(rawDebugName); } catch { debugName = rawDebugName; }
    }
    req.telegramUser = { id: String(debugId), name: debugName };
    return next();
  }

  return res.status(401).json({ error: 'no_auth_provided' });
}

module.exports = { telegramAuth };
