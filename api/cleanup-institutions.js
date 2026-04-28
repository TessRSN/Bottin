/**
 * GET /api/cleanup-institutions?key=YOUR_BACKUP_SECRET&action=...
 *
 * Endpoint admin one-shot pour le nettoyage final des institutions:
 *   action=rename            : applique 30 renommages dans les fiches
 *                              membres (find/replace, multi-institutions
 *                              preservees grace au split sur ';')
 *   action=archive-unused    : archive 5 fiches catalogue inutilisees
 *   action=add-no-institution: cree la fiche "Pas d'institution
 *                              (travailleur autonome)" sans coords
 *   action=preview           : liste ce qui serait modifie sans rien faire
 *
 * Une fois execute, ce fichier peut etre supprime.
 */
const { Client } = require('@notionhq/client');
const { getAllMembers, getAllInstitutions, createInstitution, INST_PROP } = require('../lib/notion');

let _notion;
function notion() {
  if (!_notion) _notion = new Client({ auth: process.env.NOTION_KEY });
  return _notion;
}

// 30 renames a appliquer dans les fiches membres
const RENAMES = [
  ['CRCHUM - Centre de recherche du CHUM', 'CRCHUM - Centre de Recherche du CHUM'],
  ['RI-MUHC', 'RI-MUHC - Research Institute of McGill University Health Centre'],
  ['CHU de Québec-Université Laval - Centre hospitalier universitaire de Québec-Université Laval', 'CHU de Québec - Université Laval'],
  ['Centre de médecine comportementale de Montréal', 'CMCM - Centre de médecine comportementale de Montréal'],
  ['Centre de recherche du CHU de Québec-Université Laval', 'CHU de Québec - Université Laval'],
  ['CHU-Sainte Justine', 'CHU Sainte-Justine'],
  ["CIUSSS du Nord-de-l'île-de-Montréal - Centre d'innovation NIM Intelliance", "CIUSSS du Nord-de-l'Île-de-Montréal"],
  ["CIUSSS-l'Ouest-de-l'Île-de-Montréal", "CIUSSS du Centre-Ouest de l'île de Montréal"],
  ['CRCHU de Québec - Université Laval (FRQS)', 'CRCHU de Québec - Université Laval'],
  ['CRIUGM - Centre de recherche institut universitaire de gêriatrie de Montréal', "CRIUGM - Centre de recherche de l'Institut Universitaire de Gériatrie de Montréal"],
  ["CRIUGM - Centre de recherche l'Institut universitaire de gériatrie de Montréal", "CRIUGM - Centre de recherche de l'Institut Universitaire de Gériatrie de Montréal"],
  ["École d’optométrie Université de Montréal", "École d'optométrie Université de Montréal"],
  ["École de santé publique de l'Université de Montréal", "ESPUM - École de santé publique de l'Université de Montréal"],
  ['ETS', 'ETS - École de technologie supérieure'],
  ['ICM - Institut de cardiologie de Montréal', 'ICM - Institut de Cardiologie de Montréal'],
  ['Institut en psychiatrie légale Philippe-Pinel', 'INPLPP - Institut national de Psychiatrie légale Philippe-Pinel'],
  ["Montreal Children's Hospital - MUHC", "Montreal Children's Hospital"],
  ['RSN', 'RSN - Réseau Santé Numérique'],
  ['Université d’Ottawa', "Université d'Ottawa"],
  ['Université de montréal', 'Université de Montréal'],
  ['Université McGill', 'McGill University'],
  ['UQAC', 'UQAC - Université du Québec à Chicoutimi'],
  ['UQTR - Université du Québec à Trois Rivières', 'UQTR - Université du Québec à Trois-Rivières'],
  ['VITAM, Precrisa, CEPPP - Center of Excellence on Partnership with Patients and Public', 'VITAM'],
  ["CIUSSS du Nord-de-l'île-de-Montréal - Centre d'innovation NIM Intelliance, CÉAMS - Centre d'études avancées en médecine du sommeil, Université de Montréal", "CIUSSS du Nord-de-l'Île-de-Montréal"],
  ['Institut de recherche du Centre Universitaire de Santé McGill', 'RI-MUHC - Research Institute of McGill University Health Centre'],
  ['Douglas Mental Health University Institure', 'Douglas Research Centre'],
  ['Douglas Mental Health University Institute', 'Douglas Research Centre'],
  ["CIUSSS de l'Estrie - CHU de Sherbrooke", "CIUSSS de l'Estrie-CHUS"],
];

// 5 fiches catalogue inutilisees a archiver
const UNUSED_TO_ARCHIVE = [
  'CHUS - Centre hospitalier universitaire de sherbrooke',
  'Collège des médecins du Québec',
  'CRCHU de Québec - Université Laval',
  "École d'optométrie Université de Montréal",
  'Health Technology Assessment Unit of the MUHC - McGill University Health Center',
];

// Replace one occurrence (or multiple) of an institution name within a
// member's institution string, preserving the rest (other institutions
// separated by ';'). Case-sensitive exact match for safety.
function applyRename(currentValue, fromName, toName) {
  if (!currentValue) return currentValue;
  const parts = currentValue.split(';').map(s => s.trim());
  const newParts = parts.map(p => p === fromName ? toName : p);
  // Avoid duplicates after rename (e.g. someone with both "ETS" and
  // "ETS - École de technologie supérieure" would otherwise have it twice)
  const seen = new Set();
  const dedup = newParts.filter(p => {
    if (!p) return false;
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  return dedup.join('; ');
}

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const action = (req.query && req.query.action) || 'preview';

  try {
    if (action === 'rename' || action === 'preview') {
      const members = await getAllMembers();
      const updates = [];
      for (const m of members) {
        if (!m.institution) continue;
        let newValue = m.institution;
        for (const [from, to] of RENAMES) {
          newValue = applyRename(newValue, from, to);
        }
        if (newValue !== m.institution) {
          updates.push({ id: m.id, name: `${m.prenom} ${m.nom}`, before: m.institution, after: newValue });
        }
      }

      if (action === 'preview') {
        return res.status(200).json({ ok: true, action: 'preview', count: updates.length, updates });
      }

      // Apply for real
      const results = { updated: 0, failed: 0, errors: [] };
      for (const u of updates) {
        try {
          await notion().pages.update({
            page_id: u.id,
            properties: {
              [require('../lib/notion').PROP.institution]: { rich_text: [{ text: { content: u.after.slice(0, 2000) } }] },
            },
          });
          results.updated++;
        } catch (err) {
          results.failed++;
          results.errors.push({ name: u.name, error: err.message });
          if (results.errors.length >= 5) break;
        }
      }
      return res.status(200).json({ ok: results.failed === 0, action: 'rename', count: updates.length, ...results });
    }

    if (action === 'archive-unused') {
      const all = await getAllInstitutions();
      const results = { archived: 0, notFound: [], failed: 0, errors: [] };
      for (const name of UNUSED_TO_ARCHIVE) {
        const inst = all.find(i => i.name === name);
        if (!inst) { results.notFound.push(name); continue; }
        try {
          await notion().pages.update({ page_id: inst.id, archived: true });
          results.archived++;
        } catch (err) {
          results.failed++;
          results.errors.push({ name, error: err.message });
        }
      }
      return res.status(200).json({ ok: results.failed === 0, action: 'archive-unused', ...results });
    }

    if (action === 'add-no-institution') {
      const name = "Pas d'institution (travailleur autonome)";
      // Check if already exists
      const all = await getAllInstitutions();
      const existing = all.find(i => i.name === name);
      if (existing) {
        return res.status(200).json({ ok: true, action: 'add-no-institution', skipped: true, message: 'Already exists' });
      }
      // Create with status Validée and no coords (so it's offered in dropdown but not on the map)
      // Note: getValidatedInstitutions filters out entries with null coords from the public list,
      // so we use a sentinel of 0,0 which is not a real Quebec location and the map will skip it
      // visually anyway. But for the autocomplete it'll still work.
      // Actually: better to use null coords and accept that this entry won't appear in /api/institutions
      // (since we filter null lat/lng there). The frontend join.html would not see it in autocomplete,
      // but since members type "Travailleur autonome" freely it falls through to the "not in catalog"
      // path which is fine.
      await createInstitution({
        name,
        address: '',
        latitude: null,
        longitude: null,
        statut: 'Validée',
      });
      return res.status(200).json({ ok: true, action: 'add-no-institution', created: true });
    }

    return res.status(400).json({ error: 'Unknown action. Use action=preview|rename|archive-unused|add-no-institution' });
  } catch (err) {
    console.error('cleanup-institutions error:', err);
    return res.status(500).json({ error: 'Failed', message: err.message });
  }
};

module.exports.config = { maxDuration: 300 };
