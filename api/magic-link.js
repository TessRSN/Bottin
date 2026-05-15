/**
 * POST /api/magic-link
 * Body: { email: "xxx@xxx.ca", lang: "fr" }
 *
 * Looks up the email in Notion. If found, sends a magic link.
 * Always returns success (to not reveal if email exists).
 */
const { findByEmail } = require('../lib/notion');
const { signToken } = require('../lib/token');
const { sendMagicLink } = require('../lib/email');

// Simple in-memory rate limiter
const attempts = new Map();
const RATE_LIMIT = 3; // max per hour
const RATE_WINDOW = 3600000; // 1 hour

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, lang = 'fr' } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email required' });
  }

  const normalized = email.toLowerCase().trim();

  // Rate limiting
  const now = Date.now();
  const key = normalized;
  const history = (attempts.get(key) || []).filter(t => now - t < RATE_WINDOW);
  if (history.length >= RATE_LIMIT) {
    // Don't reveal rate limit — just return success
    return res.status(200).json({ ok: true });
  }
  history.push(now);
  attempts.set(key, history);

  try {
    const page = await findByEmail(normalized);

    if (page) {
      const prenom = page.properties['Prénom']?.title?.[0]?.plain_text || '';
      const nom = page.properties['Nom']?.rich_text?.[0]?.plain_text || '';
      const name = `${prenom} ${nom}`.trim() || 'Membre';

      const token = signToken(page.id, normalized);
      const baseUrl = process.env.BASE_URL || 'https://bottin.rsn.quebec';
      const magicUrl = `${baseUrl}/edit.html?token=${token}&lang=${encodeURIComponent(lang)}`;

      await sendMagicLink(normalized, name, magicUrl, lang);
    }
    // Always return success (don't reveal if email exists)
  } catch (err) {
    console.error('Magic link error:', err);
    // Still return success to not reveal info
  }

  return res.status(200).json({ ok: true });
};
