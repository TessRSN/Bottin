/**
 * Membership renewal endpoint (Phase 3 - Loi 25).
 *
 * GET  /api/renew?token=xxx
 *   Validates the token and returns { ok, name, email, dateRenouvellement }
 *   so renew.html can show "Confirmer pour [Name] (echeance [date])".
 *   Does NOT mutate anything.
 *
 * POST /api/renew?token=xxx
 *   Confirms the renewal:
 *     - dateDebut := today
 *     - dateRenouvellement := today + 2 years
 *     - reset the 3 retention email checkboxes
 *     - send confirmation email
 *
 * The token is signed with kind="renew" and lasts 90 days (long enough
 * to cover the entire 60-day reminder window plus margin).
 */
const { verifyToken } = require('../lib/token');
const { getProfile, renewMembership } = require('../lib/notion');
const { sendRenewalConfirmation } = require('../lib/email');

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  const token = (req.query && req.query.token) || (req.body && req.body.token) || '';
  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }
  const payload = verifyToken(token);
  if (!payload || payload.kind !== 'renew') {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    if (req.method === 'GET') {
      const profile = await getProfile(payload.pageId);
      const name = `${(profile.prenom || '').trim()} ${(profile.nom || '').trim()}`.trim();
      return res.status(200).json({
        ok: true,
        name,
        email: profile.email,
        dateRenouvellement: profile.dateRenouvellement,
      });
    }

    if (req.method === 'POST') {
      const today = todayISO();
      const result = await renewMembership(payload.pageId, today);
      // Send confirmation (non-blocking — failure shouldn't break the renewal)
      try {
        const profile = await getProfile(payload.pageId);
        const firstName = profile.prenom || 'Membre';
        await sendRenewalConfirmation(profile.email, firstName, result.dateRenouvellement);
      } catch (mailErr) {
        console.error('[renew] confirmation email failed:', mailErr.message);
      }
      return res.status(200).json({ ok: true, dateDebut: result.dateDebut, dateRenouvellement: result.dateRenouvellement });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[renew] error:', err.message, err.stack);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};

module.exports.config = { maxDuration: 30 };
