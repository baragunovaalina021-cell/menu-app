const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');

const router = express.Router();

const TRIAL_DAYS = 30;
const FREE_MEMBER_LIMIT = 1; // free plan: 1 person; premium: unlimited family members

function genInviteCode() {
  return nanoid(6).toUpperCase();
}

function familyStatus(family) {
  const now = Date.now();
  const trialActive = now < family.trial_ends_at;
  return {
    id: family.id,
    inviteCode: family.invite_code,
    isPremium: !!family.is_premium,
    trialActive,
    trialEndsAt: family.trial_ends_at,
    accessActive: trialActive || !!family.is_premium,
  };
}

// Get or create the current user's profile + family.
// If the user doesn't exist yet, a new family is created for them with a 30-day trial.
router.get('/me', (req, res) => {
  const { id, name } = req.telegramUser;
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(id);

  if (!user) {
    const familyId = nanoid();
    const now = Date.now();
    db.prepare(
      'INSERT INTO families (id, invite_code, created_at, trial_ends_at, is_premium) VALUES (?, ?, ?, ?, 0)'
    ).run(familyId, genInviteCode(), now, now + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    db.prepare('INSERT INTO users (telegram_id, name, family_id, created_at) VALUES (?, ?, ?, ?)').run(
      id, name, familyId, now
    );
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(id);
  }

  const family = db.prepare('SELECT * FROM families WHERE id = ?').get(user.family_id);
  const memberCount = db.prepare('SELECT COUNT(*) c FROM users WHERE family_id = ?').get(family.id).c;

  res.json({
    user: { id: user.telegram_id, name: user.name },
    family: { ...familyStatus(family), memberCount, freeMemberLimit: FREE_MEMBER_LIMIT },
  });
});

// Join an existing family by invite code
router.post('/join', (req, res) => {
  const { id, name } = req.telegramUser;
  const { inviteCode } = req.body;
  if (!inviteCode) return res.status(400).json({ error: 'invite_code_required' });

  const family = db.prepare('SELECT * FROM families WHERE invite_code = ?').get(inviteCode.toUpperCase());
  if (!family) return res.status(404).json({ error: 'family_not_found' });

  const memberCount = db.prepare('SELECT COUNT(*) c FROM users WHERE family_id = ?').get(family.id).c;
  const trialActive = Date.now() < family.trial_ends_at;
  if (memberCount >= FREE_MEMBER_LIMIT && !family.is_premium && !trialActive) {
    return res.status(402).json({ error: 'subscription_required', message: 'Нужна подписка, чтобы добавить ещё одного человека в семью.' });
  }

  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE users SET family_id = ?, name = ? WHERE telegram_id = ?').run(family.id, name, id);
  } else {
    db.prepare('INSERT INTO users (telegram_id, name, family_id, created_at) VALUES (?, ?, ?, ?)').run(
      id, name, family.id, Date.now()
    );
  }

  res.json({ ok: true, familyId: family.id });
});

router.get('/status', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(req.telegramUser.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  const family = db.prepare('SELECT * FROM families WHERE id = ?').get(user.family_id);
  const memberCount = db.prepare('SELECT COUNT(*) c FROM users WHERE family_id = ?').get(family.id).c;
  res.json({ ...familyStatus(family), memberCount, freeMemberLimit: FREE_MEMBER_LIMIT });
});

// Dev-only helper to simulate a successful subscription purchase
router.post('/mock-subscribe', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(req.telegramUser.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  db.prepare('UPDATE families SET is_premium = 1 WHERE id = ?').run(user.family_id);
  res.json({ ok: true });
});

module.exports = router;
