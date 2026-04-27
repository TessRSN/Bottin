/**
 * GET /api/import-institutions?key=YOUR_BACKUP_SECRET
 *
 * One-shot endpoint qui importe les 154 institutions historiques (anciennement
 * hardcodées dans index.html via la constante GEOCODE) dans la base Notion
 * "Institutions" avec statut = "Validée".
 *
 * Idempotent : si une institution du même nom existe déjà dans la base,
 * elle est skippée (le script peut être relancé sans danger en cas de
 * timeout — Vercel Hobby = 60s max, 154 inserts ~= 30s).
 *
 * À appeler UNE FOIS après création de la base Notion. Une fois exécuté
 * avec succès, ce fichier peut être supprimé du repo.
 */
const { findInstitutionByName, createInstitution } = require('../lib/notion');
const initialInstitutions = require('../data/initial-institutions.js');

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.NOTION_INSTITUTIONS_DB_ID) {
    return res.status(500).json({
      error: 'NOTION_INSTITUTIONS_DB_ID environment variable is not configured on Vercel',
    });
  }

  const results = { total: initialInstitutions.length, created: 0, skipped: 0, failed: 0, errors: [] };

  for (const inst of initialInstitutions) {
    try {
      const existing = await findInstitutionByName(inst.name);
      if (existing) {
        results.skipped++;
        continue;
      }
      await createInstitution({
        name: inst.name,
        latitude: inst.lat,
        longitude: inst.lng,
        statut: 'Validée',
      });
      results.created++;
    } catch (err) {
      results.failed++;
      results.errors.push({ name: inst.name, error: err.message });
      if (results.errors.length >= 5) break; // bail out on repeated failures
    }
  }

  return res.status(200).json({ ok: results.failed === 0, ...results });
};

module.exports.config = { maxDuration: 300 };
