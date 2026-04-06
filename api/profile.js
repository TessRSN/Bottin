/**
 * GET  /api/profile?token=xxx → returns member profile (pre-fill form)
 * POST /api/profile?token=xxx → updates member profile
 */
const { getProfile, updateProfile } = require('../lib/notion');
const { verifyToken } = require('../lib/token');

// Fields that members can edit themselves
const EDITABLE_FIELDS = [
  'prenom', 'nom', 'email', 'email2', 'institution', 'statut',
  'reseau', 'expertise', 'themes', 'projet', 'etudiants',
  'axes', 'principes', 'champs', 'orcid', 'cv', 'consent',
];

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.query.token || req.headers['x-token'];
  if (!token) return res.status(401).json({ error: 'Token required' });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  try {
    if (req.method === 'GET') {
      const profile = await getProfile(payload.pageId);
      return res.status(200).json(profile);
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      // Only allow editable fields
      const data = {};
      for (const key of EDITABLE_FIELDS) {
        if (body[key] !== undefined) data[key] = body[key];
      }

      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: 'No editable fields provided' });
      }

      await updateProfile(payload.pageId, data);
      return res.status(200).json({ ok: true, message: 'Profile updated' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Profile error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
