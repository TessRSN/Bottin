/**
 * GET /api/cleanup-institutions?key=YOUR_BACKUP_SECRET&action=...
 *
 * Endpoint admin one-shot pour le nettoyage final des institutions.
 *
 * Actions:
 *   preview          : liste les renommages sans rien modifier
 *   rename           : applique tous les renommages dans les fiches membres
 *   archive-unused   : archive les fiches catalogue inutilisees
 *   add-no-institution : cree "Pas d'institution (travailleur autonome)"
 *   restore-archived : restaure 3 fiches archivees par erreur
 *   create-new       : cree les ~10 nouvelles fiches du catalogue (Cat. B)
 *   final-pass       : extension de rename pour les cas rates au 1er pass
 *                      (typo Sherbrooke + travailleurs autonomes + Mathieu/Danina)
 */
const { Client } = require('@notionhq/client');
const { getAllMembers, getAllInstitutions, createInstitution, PROP, INST_PROP } = require('../lib/notion');

let _notion;
function notion() {
  if (!_notion) _notion = new Client({ auth: process.env.NOTION_KEY });
  return _notion;
}

const RENAMES_PASS1 = [
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

const RENAMES_PASS2 = [
  ['univerrsité de Sherbrooke', 'Université de Sherbrooke'],
  ['Travailleur autonome', "Pas d'institution (travailleur autonome)"],
  ['Travailleur Autonome', "Pas d'institution (travailleur autonome)"],
  ['Impulsions', 'COGEP inc'],
  ['OROT', 'Waterloo Regional Health Network'],
];

const UNUSED_TO_ARCHIVE = [
  'CHUS - Centre hospitalier universitaire de sherbrooke',
  'Collège des médecins du Québec',
  'CRCHU de Québec - Université Laval',
  "École d'optométrie Université de Montréal",
  'Health Technology Assessment Unit of the MUHC - McGill University Health Center',
];

const TO_RESTORE = [
  'CRCHU de Québec - Université Laval',
  "École d'optométrie Université de Montréal",
  'Health Technology Assessment Unit of the MUHC - McGill University Health Center',
];

const NEW_INSTITUTIONS = [
  { name: 'Careteam Technologies', latitude: 49.2878, longitude: -123.1183 },
  { name: "CIUSSS de l'Estrie-CHUS", latitude: 45.4014, longitude: -71.8836 },
  { name: 'COGEP inc', latitude: null, longitude: null },
  { name: 'Lady Davis Institute', latitude: 45.4928, longitude: -73.6308 },
  { name: 'MaSantéPhysique.ai', latitude: 45.4972, longitude: -73.5634 },
  { name: 'Numana Tech', latitude: 45.5025, longitude: -73.5585 },
  { name: 'Waterloo Regional Health Network', latitude: 43.4563, longitude: -80.5120 },
  { name: 'Solution Moveck inc.', latitude: null, longitude: null },
  { name: 'StatSciences Inc.', latitude: null, longitude: null },
  { name: 'Strataide', latitude: null, longitude: null },
  { name: 'Universus Technologies', latitude: null, longitude: null },
];

function applyRename(currentValue, fromName, toName) {
  if (!currentValue) return currentValue;
  const parts = currentValue.split(';').map(s => s.trim());
  const newParts = parts.map(p => p === fromName ? toName : p);
  const seen = new Set();
  return newParts.filter(p => {
    if (!p) return false;
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  }).join('; ');
}

async function findArchivedByName(dbId, name) {
  const resp = await notion().databases.query({
    database_id: dbId,
    filter: { property: INST_PROP.nom, title: { equals: name } },
    page_size: 5,
  });
  return resp.results.find(p => p.archived) || null;
}

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const action = (req.query && req.query.action) || 'preview';

  try {
    if (action === 'rename' || action === 'preview' || action === 'final-pass') {
      const renamesToApply = action === 'final-pass' ? RENAMES_PASS2 : RENAMES_PASS1;
      const members = await getAllMembers();
      const updates = [];
      for (const m of members) {
        if (!m.institution) continue;
        let newValue = m.institution;
        for (const [from, to] of renamesToApply) {
          newValue = applyRename(newValue, from, to);
        }
        if (newValue !== m.institution) {
          updates.push({ id: m.id, name: `${m.prenom} ${m.nom}`, before: m.institution, after: newValue });
        }
      }

      if (action === 'preview') {
        return res.status(200).json({ ok: true, action: 'preview', count: updates.length, updates });
      }

      const results = { updated: 0, failed: 0, errors: [] };
      for (const u of updates) {
        try {
          await notion().pages.update({
            page_id: u.id,
            properties: {
              [PROP.institution]: { rich_text: [{ text: { content: u.after.slice(0, 2000) } }] },
            },
          });
          results.updated++;
        } catch (err) {
          results.failed++;
          results.errors.push({ name: u.name, error: err.message });
          if (results.errors.length >= 5) break;
        }
      }
      return res.status(200).json({ ok: results.failed === 0, action, count: updates.length, ...results });
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

    if (action === 'restore-archived') {
      const dbId = process.env.NOTION_INSTITUTIONS_DB_ID;
      const results = { restored: 0, notFound: [], failed: 0, errors: [] };
      for (const name of TO_RESTORE) {
        try {
          const archivedPage = await findArchivedByName(dbId, name);
          if (!archivedPage) { results.notFound.push(name); continue; }
          await notion().pages.update({ page_id: archivedPage.id, archived: false });
          results.restored++;
        } catch (err) {
          results.failed++;
          results.errors.push({ name, error: err.message });
        }
      }
      return res.status(200).json({ ok: results.failed === 0, action: 'restore-archived', ...results });
    }

    if (action === 'create-new') {
      const all = await getAllInstitutions();
      const existing = new Set(all.map(i => i.name));
      const results = { created: 0, skipped: 0, failed: 0, errors: [] };
      for (const inst of NEW_INSTITUTIONS) {
        if (existing.has(inst.name)) { results.skipped++; continue; }
        try {
          await createInstitution({
            name: inst.name,
            address: '',
            latitude: inst.latitude,
            longitude: inst.longitude,
            statut: 'Validée',
          });
          results.created++;
        } catch (err) {
          results.failed++;
          results.errors.push({ name: inst.name, error: err.message });
        }
      }
      return res.status(200).json({ ok: results.failed === 0, action: 'create-new', ...results });
    }

    if (action === 'finalize-coords') {
      // Update existing institutions with their newly-discovered coords,
      // and recreate the 3 fiches catalogue archivees par erreur.
      const all = await getAllInstitutions();
      const byName = {};
      for (const i of all) byName[i.name] = i;

      const COORDS_UPDATES = [
        { name: 'Solution Moveck inc.', lat: 46.8135, lng: -71.2263 },
        { name: 'StatSciences Inc.', lat: 45.3517, lng: -73.9030 },
        { name: 'Strataide', lat: 45.5052, lng: -73.5728 },
        { name: 'Universus Technologies', lat: 45.4983, lng: -73.5588 },
        { name: 'COGEP inc', lat: 46.8393, lng: -71.2826 },
        { name: "Pas d'institution (travailleur autonome)", lat: 45.5017, lng: -73.5673 },
      ];

      const TO_RECREATE = [
        { name: 'CRCHU de Québec - Université Laval', lat: 46.7660, lng: -71.2770 },
        { name: "École d'optométrie Université de Montréal", lat: 45.5017, lng: -73.6162 },
        { name: 'Health Technology Assessment Unit of the MUHC - McGill University Health Center', lat: 45.4728, lng: -73.6012 },
      ];

      const results = { updated: 0, created: 0, skipped: 0, failed: 0, errors: [] };

      for (const u of COORDS_UPDATES) {
        const inst = byName[u.name];
        if (!inst) { results.skipped++; continue; }
        try {
          await notion().pages.update({
            page_id: inst.id,
            properties: {
              [INST_PROP.latitude]: { number: u.lat },
              [INST_PROP.longitude]: { number: u.lng },
            },
          });
          results.updated++;
        } catch (err) {
          results.failed++;
          results.errors.push({ name: u.name, error: err.message });
        }
      }

      for (const c of TO_RECREATE) {
        if (byName[c.name]) { results.skipped++; continue; }
        try {
          await createInstitution({
            name: c.name,
            address: '',
            latitude: c.lat,
            longitude: c.lng,
            statut: 'Validée',
          });
          results.created++;
        } catch (err) {
          results.failed++;
          results.errors.push({ name: c.name, error: err.message });
        }
      }

      return res.status(200).json({ ok: results.failed === 0, action: 'finalize-coords', ...results });
    }

    if (action === 'add-no-institution') {
      const name = "Pas d'institution (travailleur autonome)";
      const all = await getAllInstitutions();
      const existing = all.find(i => i.name === name);
      if (existing) {
        return res.status(200).json({ ok: true, action, skipped: true, message: 'Already exists' });
      }
      await createInstitution({
        name,
        address: '',
        latitude: null,
        longitude: null,
        statut: 'Validée',
      });
      return res.status(200).json({ ok: true, action, created: true });
    }

    return res.status(400).json({ error: 'Unknown action. Use: preview|rename|archive-unused|add-no-institution|restore-archived|create-new|final-pass' });
  } catch (err) {
    console.error('cleanup-institutions error:', err);
    return res.status(500).json({ error: 'Failed', message: err.message });
  }
};

module.exports.config = { maxDuration: 300 };
