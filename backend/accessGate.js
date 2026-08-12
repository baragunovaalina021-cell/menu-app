const db = require('./db');

/**
 * Blocks write actions once the family's free trial has ended and they haven't subscribed.
 * Read (GET) requests are always allowed so the app never fully locks users out of their data.
 */
function requireActiveAccess(req, res, next) {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(req.telegramUser.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  const family = db.prepare('SELECT * FROM families WHERE id = ?').get(user.family_id);

  const trialActive = Date.now() < family.trial_ends_at;
  if (family.is_premium || trialActive) {
    req.family = family;
    return next();
  }

  return res.status(402).json({
    error: 'subscription_required',
    message: 'Бесплатный период закончился. Оформите подписку, чтобы продолжить редактировать меню и список покупок.',
  });
}

module.exports = { requireActiveAccess };
