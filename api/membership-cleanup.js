/**
 * GET /api/membership-cleanup?key=YOUR_BACKUP_SECRET&action=...
 *
 * Endpoint admin pour le nettoyage de la base Membres.
 *
 * Modes:
 *   action=archive-non-members
 *     Archive (soft delete) toutes les fiches Membres qui:
 *       1. N'ont pas d'email principal valide
 *       OU
 *       2. Ont un format chaotique (parentheses + sauts de ligne)
 *     Cible specifique: les ~16 fiches identifiees dans le rapport
 *     comme non-membres (etudiants UdeM mal saisis, descriptions de
 *     projet, noms collés sans email).
 *
 *   action=preview (defaut)
 *     Liste les fiches qui SERAIENT archivees, sans rien modifier.
 *     A executer avant action=archive-non-members pour verifier.
 */
const { Client } = require('@notionhq/client');
const { getAllMembers } = require('../lib/notion');

let _notion;
function notion() {
  if (!_notion) _notion = new Client({ auth: process.env.NOTION_KEY });
  return _notion;
}

function isNonMember(m) {
  // No email at all → likely a fake/test entry not in CSV
  if (!m.email || !m.email.trim()) return { match: true, reason: 'no email' };
  // Email contains junk like "udem) : foo@bar.com" or "foo@bar.com,name"
  const e = m.email.trim();
  if (e.includes(' ') || e.includes(',') || e.includes(')') || e.includes('(')) {
    return { match: true, reason: 'malformed email' };
  }
  return { match: false };
}

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const action = (req.query && req.query.action) || 'preview';

  try {
    const all = await getAllMembers();
    const candidates = [];
    for (const m of all) {
      const check = isNonMember(m);
      if (check.match) {
        candidates.push({ id: m.id, prenom: m.prenom, nom: m.nom, email: m.email, reason: check.reason });
      }
    }

    if (action === 'preview') {
      return res.status(200).json({ ok: true, action: 'preview', count: candidates.length, candidates });
    }

    if (action === 'archive-non-members') {
      const results = { count: candidates.length, archived: 0, failed: 0, errors: [] };
      for (const c of candidates) {
        try {
          await notion().pages.update({ page_id: c.id, archived: true });
          results.archived++;
        } catch (err) {
          results.failed++;
          results.errors.push({ name: `${c.prenom} ${c.nom}`, error: err.message });
        }
      }
      return res.status(200).json({ ok: results.failed === 0, action, ...results });
    }

    return res.status(400).json({ error: 'Unknown action. Use action=preview or action=archive-non-members' });
  } catch (err) {
    console.error('membership-cleanup error:', err);
    return res.status(500).json({ error: 'Failed', message: err.message });
  }
};

module.exports.config = { maxDuration: 120 };
