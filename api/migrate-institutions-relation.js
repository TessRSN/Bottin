/**
 * GET /api/migrate-institutions-relation?key=YOUR_BACKUP_SECRET&action=...
 *
 * Migration one-shot Phase 2: remplit la propriete Notion 'Institution
 * liée' (type Relation vers la base Institutions) a partir de la
 * propriete texte 'Institution' existante.
 *
 * Pour chaque membre:
 *   1. Splitte sa string 'institution' sur ';' (multi-institutions)
 *   2. Pour chaque morceau, cherche l'ID de la fiche correspondante
 *      dans la base Institutions (toutes statuts: Validee + En attente)
 *   3. Met a jour la Relation avec la liste des IDs trouves
 *   4. Si un nom n'a pas de match, log l'ecart sans bloquer la migration
 *
 * Actions:
 *   preview : liste les changements sans rien modifier
 *   apply   : applique la migration
 *
 * Idempotent: re-soumettre fait juste les memes updates.
 */
const { Client } = require('@notionhq/client');
const { getAllMembers, getAllInstitutions, PROP } = require('../lib/notion');

let _notion;
function notion() {
  if (!_notion) _notion = new Client({ auth: process.env.NOTION_KEY });
  return _notion;
}

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const action = (req.query && req.query.action) || 'preview';

  try {
    const [members, institutions] = await Promise.all([getAllMembers(), getAllInstitutions()]);

    // Build a name -> page id map (excluding archived). Include all statuses
    // (Validée + En attente) so members with pending institutions still get
    // their relation linked.
    const nameToId = new Map();
    for (const inst of institutions) {
      if (inst.name) nameToId.set(inst.name, inst.id);
    }

    const planned = [];
    const noMatch = []; // institution names not found in catalog

    for (const m of members) {
      if (!m.institution) continue;
      const parts = m.institution.split(';').map(s => s.trim()).filter(Boolean);
      const ids = [];
      const missing = [];
      for (const p of parts) {
        const id = nameToId.get(p);
        if (id) {
          if (!ids.includes(id)) ids.push(id);
        } else {
          missing.push(p);
        }
      }

      if (missing.length > 0) {
        noMatch.push({ member: `${m.prenom} ${m.nom}`, email: m.email, missingNames: missing });
      }

      // Compare with current relation: only enqueue update if different
      const currentIds = new Set(m.institutionIds || []);
      const newIds = new Set(ids);
      const same = currentIds.size === newIds.size && [...currentIds].every(id => newIds.has(id));
      if (!same) {
        planned.push({
          id: m.id,
          name: `${m.prenom} ${m.nom}`,
          email: m.email,
          institutionText: m.institution,
          oldRelationCount: currentIds.size,
          newRelationCount: newIds.size,
          newRelationIds: ids,
        });
      }
    }

    if (action === 'preview') {
      return res.status(200).json({
        ok: true,
        action: 'preview',
        totalMembers: members.length,
        plannedUpdates: planned.length,
        noMatchCount: noMatch.length,
        noMatch,
        sample: planned.slice(0, 10),
      });
    }

    if (action === 'apply') {
      const results = { applied: 0, failed: 0, errors: [], noMatchCount: noMatch.length };
      for (const u of planned) {
        try {
          await notion().pages.update({
            page_id: u.id,
            properties: {
              [PROP.institutionLiee]: { relation: u.newRelationIds.map(id => ({ id })) },
            },
          });
          results.applied++;
        } catch (err) {
          results.failed++;
          results.errors.push({ member: u.name, email: u.email, error: err.message });
          if (results.errors.length >= 5) break;
        }
      }
      return res.status(200).json({ ok: results.failed === 0, action: 'apply', plannedUpdates: planned.length, ...results });
    }

    return res.status(400).json({ error: 'Use action=preview or action=apply' });
  } catch (err) {
    console.error('migrate-institutions-relation error:', err);
    return res.status(500).json({ error: 'Failed', message: err.message });
  }
};

module.exports.config = { maxDuration: 300 };
