/**
 * JWT signed tokens for three flows:
 *   - magic link (edit profile)        → 1h expiry, kind="edit"
 *   - renewal link (Phase 3 retention) → 90 days expiry, kind="renew"
 *   - email change confirmation        → 1h expiry, kind="email-change"
 */
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

function signToken(pageId, email) {
  if (!SECRET) throw new Error('JWT_SECRET not set');
  return jwt.sign({ pageId, email, kind: 'edit' }, SECRET, { expiresIn: '1h' });
}

function signRenewalToken(pageId, email) {
  if (!SECRET) throw new Error('JWT_SECRET not set');
  return jwt.sign({ pageId, email, kind: 'renew' }, SECRET, { expiresIn: '90d' });
}

/**
 * Signs a short-lived token (1h) for email change confirmation.
 * The token carries the page ID, the old (current) email and the new
 * (target) email. When the user clicks the confirmation link, the
 * receiving endpoint verifies the token and applies the swap:
 *   - email  := newEmail
 *   - email2 := oldEmail (kept as fallback, decision D.2 with Tess)
 */
function signEmailChangeToken(pageId, oldEmail, newEmail) {
  if (!SECRET) throw new Error('JWT_SECRET not set');
  return jwt.sign({ pageId, oldEmail, newEmail, kind: 'email-change' }, SECRET, { expiresIn: '1h' });
}

function verifyToken(token) {
  if (!SECRET) throw new Error('JWT_SECRET not set');
  try {
    return jwt.verify(token, SECRET);
  } catch (err) {
    return null;
  }
}

module.exports = { signToken, signRenewalToken, signEmailChangeToken, verifyToken };
