/**
 * GET /api/cleanup-composites?key=YOUR_BACKUP_SECRET[&action=...]
 *
 * Endpoint admin polyvalent pour le nettoyage de la base Institutions.
 *
 * Modes:
 *   action=reject (défaut) : passe en 'Refusée' tous les composites
 *                            (nom contenant ';'). Idempotent.
 *
 *   action=archive         : archive (soft-delete via Notion API) toutes
 *                            les fiches actuellement en statut 'Refusée'.
 *                            Les fiches archivées sortent de la vue
 *                            principale Notion mais restent récupérables
 *                            depuis la corbeille.
 *
 *   action=duplicates      : finalise le nettoyage des doublons identifiés
 *                            par l'analyse manuelle:
 *                              - Refuse 13 doublons orthographiques /
 *                                acronymes / synonymes
 *                              - Refuse 2 composites cachés à virgules
 *                              - Renomme CRCHU de Québec (retire FRQS)
 *                              - Archive la fiche vide créée par accident
 *
 * Une fois ces nettoyages effectués, ce fichier peut être supprimé.
 */
const { Client } = require('@notionhq/client');
const { getAllInstitutions, updateInstitution } = require('../lib/notion');

let _notion;
function notion() {
  if (!_notion) _notion = new Client({ auth: process.env.NOTION_KEY });
  return _notion;
}

// Fiches à passer en 'Refusée' lors du nettoyage des doublons
const REJECT_BY_NAME = [
  // Orthographes / acronymes redondants — on garde la version officielle
  "École de santé publique de l'Université de Montréal",   // garder ESPUM
  "UQAC",                                                   // garder version longue
  "UQTR - Université du Québec à Trois Rivières",          // garder version avec tiret
  "CRIUGM - Centre de recherche institut universitaire de gêriatrie de Montréal", // faute "gêriatrie"
  "Douglas Mental Health University Institure",            // faute "Institure"
  "RI-MUHC",                                                // garder version longue
  "Institut de recherche du Centre Universitaire de Santé McGill", // synonyme fr de RI-MUHC
  "CHU de Québec-Université Laval - Centre hospitalier universitaire de Québec-Université Laval", // trop long
  "Centre de médecine comportementale de Montréal",        // garder CMCM acronyme
  "Institut en psychiatrie légale Philippe-Pinel",         // garder INPLPP acronyme
  "CIUSSS du Nord-de-l'île-de-Montréal - Centre d'innovation NIM Intelliance", // garder le CIUSSS général

  // Composites cachés via virgules (pas attrapés par le filtre ';')
  "VITAM, Precrisa, CEPPP - Center of Excellence on Partnership with Patients and Public",
  "CIUSSS du Nord-de-l'île-de-Montréal - Centre d'innovation NIM Intelliance, CÉAMS - Centre d'études avancées en médecine du sommeil, Université de Montréal",
];

// Fiches à renommer (titre uniquement)
const RENAME_OPS = [
  { from: "CRCHU de Québec - Université Laval (FRQS)", to: "CRCHU de Québec - Université Laval" },
];

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const action = (req.query && req.query.action) || 'reject';

  try {
    const all = await getAllInstitutions();
    const byName = {};
    for (const inst of all) byName[inst.name] = inst;

    if (action === 'archive') {
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

    if (action === 'duplicates') {
      const results = {
        rejected: 0,
        renamed: 0,
        emptyArchived: 0,
        notFound: [],
        skipped: 0,
        failed: 0,
        errors: [],
      };

      // 1) Reject duplicates by name
      for (const name of REJECT_BY_NAME) {
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

      // 2) Rename specific entries
      for (const op of RENAME_OPS) {
        const inst = byName[op.from];
        if (!inst) { results.notFound.push(`(rename) ${op.from}`); continue; }
        try {
          await updateInstitution(inst.id, { name: op.to });
          results.renamed++;
        } catch (err) {
          results.failed++;
          results.errors.push({ name: op.from, error: err.message });
        }
      }

      // 3) Archive empty entries (fiches with name === '')
      const empties = all.filter(i => !i.name || !i.name.trim());
      for (const inst of empties) {
        try {
          await notion().pages.update({ page_id: inst.id, archived: true });
          results.emptyArchived++;
        } catch (err) {
          results.failed++;
          results.errors.push({ name: '(empty)', error: err.message });
        }
      }

      return res.status(200).json({ ok: results.failed === 0, action: 'duplicates', ...results });
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
