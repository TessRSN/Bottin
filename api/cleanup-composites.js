/**
 * GET /api/cleanup-composites?key=YOUR_BACKUP_SECRET[&action=archive]
 *
 * Endpoint admin polyvalent pour le nettoyage de la base Institutions.
 *
 * Modes:
 *   (default) action=reject : passe en 'Refusée' tous les composites
 *                             (nom contenant ';'). Idempotent.
 *   action=archive          : archive (soft-delete) toutes les fiches
 *                             actuellement en statut 'Refusée'. Les
 *                             fiches archivées sortent de la vue
 *                             principale Notion mais restent
 *                             récupérables depuis la corbeille.
 *
 * Une fois ces deux nettoyages effectués, ce fichier peut être supprimé.
 */
const { Client } = require('@notionhq/client');
const { getAllInstitutions, updateInstitution } = require('../lib/notion');

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

  const action = (req.query && req.query.action) || 'reject';

  try {
    const all = await getAllInstitutions();

    if (action === 'archive') {
      // Archive all rejected institutions (soft delete via Notion API)
      const rejected = all.filter(i => i.statut === 'Refusée');
      const results = { totalRejected: rejected.length, archived: 0, failed: 0, errors: [] };
      for (const inst of rejected) {
        try {
          await notion().pages.update({ page_id: inst.id, archived: true });
          results.archived++;
        } catch (err) {
          results.failed++;
          results.errors.push({ name: inst.name, error: err.message });
          if (results.errors.length >= 3) break;
        }
      }
      return res.status(200).json({ ok: results.failed === 0, action: 'archive', ...results });
    }

    // Default: reject composites (idempotent)
    const composites = all.filter(i => i.name && i.name.includes(';'));
    const results = { totalComposites: composites.length, rejected: 0, skipped: 0, failed: 0, errors: [] };
    for (const c of composites) {
      if (c.statut === 'Refusée') { results.skipped++; continue; }
      try {
        await updateInstitution(c.id, { statut: 'Refusée' });
        results.rejected++;
      } catch (err) {
        results.failed++;
        results.errors.push({ name: c.name, error: err.message });
        if (results.errors.length >= 3) break;
      }
    }
    return res.status(200).json({ ok: results.failed === 0, action: 'reject', ...results });
  } catch (err) {
    console.error('cleanup-composites error:', err);
    return res.status(500).json({ error: 'Failed', message: err.message });
  }
};

module.exports.config = { maxDuration: 300 };
