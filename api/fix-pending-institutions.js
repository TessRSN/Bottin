/**
 * GET /api/fix-pending-institutions?key=YOUR_BACKUP_SECRET
 *
 * One-shot endpoint qui finalise le nettoyage des sub-institutions
 * extraites par /api/extract-sub-institutions:
 *
 *   1. Pour les entrées du tableau FIX_COORDS: met les bonnes coords
 *      et passe le statut à "Validée".
 *   2. Pour les entrées du tableau REJECT (doublons d'institutions
 *      existantes): passe le statut à "Refusée".
 *
 * Idempotent: skip les fiches déjà au bon statut.
 *
 * Une fois exécuté, ce fichier peut être supprimé.
 */
const { getAllInstitutions, updateInstitution } = require('../lib/notion');

// Coordonnées correctes pour les sub-institutions à valider.
// Vérifiées manuellement sur Google Maps.
const FIX_COORDS = {
  'MILA - Montréal Institute of Learning Algorithms': [45.5293, -73.6181],
  'ICM - Institut de cardiologie de Montréal': [45.5445, -73.5530],
  'CRIUGM - Centre de recherche de l\'Institut Universitaire de Gériatrie de Montréal': [45.5309, -73.6169],
  'CRA-CHUSJ - Centre de recherche Azrieli du CHU SJ': [45.5012, -73.6242],
  'Hôpital du Sacré-Coeur de Montréal': [45.5398, -73.7070],
  'Centre de recherche du CIUSSS du Nord-de-l\'Île-de-Montréal': [45.5398, -73.7070],
  'Jewish General Hospital': [45.4928, -73.6308],
  'CHUS - Centre hospitalier universitaire de sherbrooke': [45.4014, -71.8836],
  'Cégep du Vieux Montréal': [45.5170, -73.5613],
  'Collège LaSalle': [45.4980, -73.5742],
  'Collège des médecins du Québec': [45.5187, -73.5760],
  'D3SM - Douglas Data and Digital Science for Mental Health': [45.4380, -73.5912],
  'UQTR - Université du Québec à Trois Rivières': [46.3498, -72.5800],
  'CRCHU de Québec - Université Laval (FRQS)': [46.7660, -71.2770],
  'CE P-DSN - Centre d\'expertise Programme Dossier santé numérique': [46.3500, -72.5500],
  'CDSI - Computational & Data Systems Initiative': [45.5048, -73.5772],
  'RUISSS - Réseau Universitaire Intégré de Santé et de Services Sociaux': [45.5048, -73.5772],
  'RSN - Réseau Santé Numérique': [45.4728, -73.6012],
  'Living Lab ÉclairAGE': [46.3498, -72.5800],
  'Unité de soutien SSA': [46.7808, -71.2758],
  'Institut de recherche du Centre Universitaire de Santé McGill': [45.4728, -73.6012],
  'INSPQ - Institut national de santé publique du Québec': [46.8140, -71.2220],
  'Directions régionales de santé publique de Laval et de la Gaspésie': [45.5750, -73.7270],
  'Aristotle University of Thessaloniki': [40.6313, 22.9595],
  'ENOLL - European Network of Living Labs': [50.8456, 4.3554],
};

// Doublons d'institutions déjà existantes — à passer en "Refusée"
const REJECT = new Set([
  'Université McGill',                                 // = "McGill University"
  'ETS',                                                // = "ETS - École de technologie supérieure"
  'CRIUGM - Centre de recherche l\'Institut universitaire de gériatrie de Montréal', // doublon orthographique
]);

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const all = await getAllInstitutions();
    const byName = {};
    for (const inst of all) byName[inst.name] = inst;

    const results = { validated: 0, rejected: 0, notFound: [], skipped: 0, failed: 0, errors: [] };

    // 1) Apply coords + Validée
    for (const [name, coords] of Object.entries(FIX_COORDS)) {
      const inst = byName[name];
      if (!inst) { results.notFound.push(name); continue; }
      if (inst.statut === 'Validée') { results.skipped++; continue; }
      try {
        await updateInstitution(inst.id, {
          latitude: coords[0],
          longitude: coords[1],
          statut: 'Validée',
        });
        results.validated++;
      } catch (err) {
        results.failed++;
        results.errors.push({ name, error: err.message });
      }
    }

    // 2) Reject duplicates
    for (const name of REJECT) {
      const inst = byName[name];
      if (!inst) { results.notFound.push(name); continue; }
      if (inst.statut === 'Refusée') { results.skipped++; continue; }
      try {
        await updateInstitution(inst.id, { statut: 'Refusée' });
        results.rejected++;
      } catch (err) {
        results.failed++;
        results.errors.push({ name, error: err.message });
      }
    }

    return res.status(200).json({ ok: results.failed === 0, ...results });
  } catch (err) {
    console.error('fix-pending-institutions error:', err);
    return res.status(500).json({ error: 'Failed', message: err.message });
  }
};

module.exports.config = { maxDuration: 300 };
