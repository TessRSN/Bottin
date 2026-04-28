/**
 * GET /api/final-corrections?key=YOUR_BACKUP_SECRET&action=...
 *
 * Endpoint admin one-shot pour les 11 corrections finales identifiees
 * lors du cross-check CSV vs Notion:
 *   - 1 institution corrigee (Karina Prevost: Universite de Sherbrooke
 *     -> Unite de soutien SSA, CSV est correct)
 *   - 10 consents passes a 'Oui' (membres qui ont consenti dans le CSV
 *     mais dont le consent est vide dans Notion)
 *
 * Actions:
 *   preview : liste les changements sans rien modifier
 *   apply   : applique les corrections
 *
 * Une fois execute, ce fichier peut etre supprime.
 */
const { Client } = require('@notionhq/client');
const { findByEmail, PROP } = require('../lib/notion');

let _notion;
function notion() {
  if (!_notion) _notion = new Client({ auth: process.env.NOTION_KEY });
  return _notion;
}

// Karina: institution actuelle dans Notion incorrecte (Universite de Sherbrooke
// vs CSV Unite de soutien SSA Quebec - Communaute Experiences). Mise a la
// version courte du catalogue.
const INSTITUTION_FIX = {
  email: 'karina.prevost@usherbrooke.ca',
  newInstitution: 'Unité de soutien SSA',
};

// Consents CSV='Oui' mais Notion vide
const CONSENT_TO_OUI = [
  'emilie.paul-savoie@usherbrooke.ca',
  'roxane.de.la.sablonniere@umontreal.ca',
  'tina.montreuil@mcgill.ca',
  'p5fortin@uqac.ca',
  'yassine.benhajali@gmail.com',
  'elisabeth.thibaudeau@psy.ulaval.ca',
  'fberete1981@gmail.com',
  'jun.ding@mcgill.ca',
  'prevost.jantchou@umontreal.ca',
  'shady.rahayel@umontreal.ca',
];

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const action = (req.query && req.query.action) || 'preview';

  try {
    const planned = { institution: null, consents: [] };

    // Resolve Karina
    const karina = await findByEmail(INSTITUTION_FIX.email);
    if (karina) {
      planned.institution = {
        email: INSTITUTION_FIX.email,
        pageId: karina.id,
        newInstitution: INSTITUTION_FIX.newInstitution,
      };
    }

    // Resolve all 10 consents
    for (const email of CONSENT_TO_OUI) {
      const page = await findByEmail(email);
      if (page) planned.consents.push({ email, pageId: page.id });
    }

    if (action === 'preview') {
      return res.status(200).json({
        ok: true,
        action: 'preview',
        institution: planned.institution ? 1 : 0,
        consents: planned.consents.length,
        details: planned,
      });
    }

    if (action === 'apply') {
      const results = { institutionUpdated: 0, consentsUpdated: 0, failed: 0, errors: [] };

      if (planned.institution) {
        try {
          await notion().pages.update({
            page_id: planned.institution.pageId,
            properties: {
              [PROP.institution]: { rich_text: [{ text: { content: planned.institution.newInstitution } }] },
            },
          });
          results.institutionUpdated = 1;
        } catch (err) {
          results.failed++;
          results.errors.push({ stage: 'institution', email: planned.institution.email, error: err.message });
        }
      }

      for (const c of planned.consents) {
        try {
          await notion().pages.update({
            page_id: c.pageId,
            properties: {
              [PROP.consent]: { select: { name: 'Oui' } },
            },
          });
          results.consentsUpdated++;
        } catch (err) {
          results.failed++;
          results.errors.push({ stage: 'consent', email: c.email, error: err.message });
        }
      }

      return res.status(200).json({ ok: results.failed === 0, action: 'apply', ...results });
    }

    return res.status(400).json({ error: 'Use action=preview or action=apply' });
  } catch (err) {
    console.error('final-corrections error:', err);
    return res.status(500).json({ error: 'Failed', message: err.message });
  }
};

module.exports.config = { maxDuration: 120 };
