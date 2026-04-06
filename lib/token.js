/**
 * JWT magic link tokens
 * Signs a token with member's page ID and email, expires in 1 hour
 */
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const EXPIRY = '1h';

function signToken(pageId, email) {
  if (!SECRET) throw new Error('JWT_SECRET not set');
  return jwt.sign({ pageId, email }, SECRET, { expiresIn: EXPIRY });
}

function verifyToken(token) {
  if (!SECRET) throw new Error('JWT_SECRET not set');
  try {
    return jwt.verify(token, SECRET);
  } catch (err) {
    return null;
  }
}

module.exports = { signToken, verifyToken };
