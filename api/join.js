/**
 * POST /api/join
 * Body: { prenom, nom, email, statut, institution, type, themes, cv, orcid, refere, reseau, axes, principes, champs, consent }
 *
 * Creates a new member in Notion with workflow status "Nouveau".
 * Checks for duplicate email before creating.
 */
const { findByEmail, createMember } = require('../lib/notion');
const { sendJoinConfirmation } = require('../lib/email');

// Simple in-memory rate limiter
const attempts = new Map();
const RATE_LIMIT = 5;       // max submissions per hour per IP
const RATE_WINDOW = 3600000; // 1 hour

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  // Basic validation
  const { prenom, nom, email, statut, institution, type, themes, axes, consent } = body;
  if (!prenom || !nom || !email || !statut || !institution || !type || !themes || !axes || !axes.length || !consent) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  // Rate limiting by IP
  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  const now = Date.now();
  const history = (attempts.get(ip) || []).filter(function(t) { return now - t < RATE_WINDOW; });
  if (history.length >= RATE_LIMIT) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  history.push(now);
  attempts.set(ip, history);

  try {
    // Check for duplicate email
    const normalized = email.toLowerCase().trim();
    const existing = await findByEmail(normalized);
    if (existing) {
      return res.status(409).json({ ok: false, code: 'DUPLICATE' });
    }

    // Create the member
    await createMember({
      prenom: prenom.trim(),
      nom: nom.trim(),
      email: normalized,
      statut: statut.trim(),
      institution: institution.trim(),
      type: type.trim(),
      themes: (themes || '').trim(),
      cv: body.cv || null,
      orcid: body.orcid || null,
      refere: (body.refere || '').trim(),
      reseau: (body.reseau || '').trim(),
      axes: axes || [],
      principes: body.principes || [],
      champs: body.champs || [],
      consent: consent,
    });

    // Send confirmation email (non-blocking — failure shouldn't break the submission)
    try {
      await sendJoinConfirmation(normalized, prenom.trim());
    } catch (mailErr) {
      console.error('Join confirmation email failed:', mailErr.message);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Join error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports.config = { maxDuration: 30 };
