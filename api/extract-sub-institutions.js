/**
 * GET /api/extract-sub-institutions?key=YOUR_BACKUP_SECRET
 *
 * One-shot endpoint qui résout le problème des sub-institutions cachées
 * dans des composites (ex: "MILA - Montréal Institute of Learning
 * Algorithms" qui n'existe que dans "Université de Montréal; MILA - ...").
 *
 * Pour chaque composite (nom contenant ';') de la base Institutions:
 *   1. Splitte le nom sur ';'
 *   2. Pour chaque sub-institution non encore présente comme atomique:
 *      a. Géocode son nom via Nominatim (le nom à lui seul, pas l'adresse
 *         du composite — qui est souvent fausse pour la sub-institution)
 *      b. Crée une nouvelle fiche dans la base Institutions avec statut
 *         'En attente' pour que l'admin valide les coords
 *
 * Idempotent: relancer skip celles déjà créées.
 *
 * Limites:
 *   - Nominatim impose ~1 req/sec → ~28 secondes pour 28 sub-institutions
 *   - Vercel Hobby cap = 60s → on devrait passer, sinon relancer
 *   - Si Nominatim ne trouve pas, la fiche est créée sans coords
 *     (l'admin devra les ajouter manuellement)
 */
const { getAllInstitutions, findInstitutionByName, createInstitution } = require('../lib/notion');
const { geocodeAddress } = require('../lib/geocode');

// Sleep helper to respect Nominatim's 1 req/sec policy
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const allInsts = await getAllInstitutions();
    const atomicNames = new Set(
      allInsts.filter(i => i.name && !i.name.includes(';')).map(i => i.name)
    );
    const composites = allInsts.filter(i => i.name && i.name.includes(';'));

    // Collect unique sub-institutions that are not already atomic
    const subs = new Map(); // name → first composite where seen
    for (const c of composites) {
      const parts = c.name.split(';').map(p => p.trim()).filter(Boolean);
      for (const p of parts) {
        if (!atomicNames.has(p) && !subs.has(p)) {
          subs.set(p, c);
        }
      }
    }

    const results = {
      compositesFound: composites.length,
      subInstitutionsToCreate: subs.size,
      created: 0,
      geocoded: 0,
      noCoords: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    let firstCall = true;
    for (const [name, sourceComposite] of subs) {
      try {
        // Double-check it doesn't already exist (race condition safety)
        const existing = await findInstitutionByName(name);
        if (existing) { results.skipped++; continue; }

        // Respect Nominatim 1 req/s policy (skip wait on first call)
        if (!firstCall) await sleep(1100);
        firstCall = false;

        let coords = null;
        try {
          coords = await geocodeAddress(name + ', Canada');
        } catch (geoErr) {
          console.error(`[extract] Geocoding failed for "${name}":`, geoErr.message);
        }

        await createInstitution({
          name,
          address: '',
          latitude: coords ? coords.lat : null,
          longitude: coords ? coords.lng : null,
          statut: 'En attente',
        });
        results.created++;
        if (coords) results.geocoded++;
        else results.noCoords++;

        console.log(`[extract] Created "${name}" ${coords ? `at ${coords.lat},${coords.lng}` : '(no coords)'}`);
      } catch (err) {
        results.failed++;
        results.errors.push({ name, error: err.message });
        if (results.errors.length >= 3) break; // bail out on repeated failures
      }
    }

    return res.status(200).json({ ok: results.failed === 0, ...results });
  } catch (err) {
    console.error('extract-sub-institutions error:', err);
    return res.status(500).json({ error: 'Failed', message: err.message });
  }
};

module.exports.config = { maxDuration: 300 };
