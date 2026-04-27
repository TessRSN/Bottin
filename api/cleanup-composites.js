/**
 * GET /api/cleanup-composites?key=YOUR_BACKUP_SECRET
 *
 * Passe en statut 'Refusée' toutes les institutions composites (nom
 * contenant ';') de la base Notion. Ces entrées historiques servaient
 * à mapper les anciennes chaînes CSV mais sont devenues redondantes
 * depuis qu'on:
 *   1. Split l'institution sur ';' au chargement (commit 4a8a3d2)
 *   2. A créé les sub-institutions manquantes comme entrées atomiques
 *      validées (commit cd837dc)
 *
 * Idempotent: skip celles déjà 'Refusée'.
 *
 * On les passe en 'Refusée' plutôt que de les supprimer définitivement
 * pour garder l'historique. L'API /api/institutions ne retourne que les
 * 'Validée' donc elles disparaissent automatiquement du bottin et du
 * formulaire d'inscription.
 */
const { getAllInstitutions, updateInstitution } = require('../lib/notion');

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const all = await getAllInstitutions();
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

    return res.status(200).json({ ok: results.failed === 0, ...results });
  } catch (err) {
    console.error('cleanup-composites error:', err);
    return res.status(500).json({ error: 'Failed', message: err.message });
  }
};

module.exports.config = { maxDuration: 120 };
