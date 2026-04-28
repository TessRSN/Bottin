/**
 * JWT signed tokens for two flows:
 *   - magic link (edit profile)        → 1h expiry, kind="edit"
 *   - renewal link (Phase 3 retention) → 90 days expiry, kind="renew"
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

function verifyToken(token) {
  if (!SECRET) throw new Error('JWT_SECRET not set');
  try {
    return jwt.verify(token, SECRET);
  } catch (err) {
    return null;
  }
}

module.exports = { signToken, signRenewalToken, verifyToken };
