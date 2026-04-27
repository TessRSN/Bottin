/**
 * POST /api/import-dates?key=YOUR_BACKUP_SECRET
 * Body: { records: [{ email, dateDebut, dateRenouvellement }, ...] }
 *
 * Endpoint admin one-shot pour importer les dates d'adhésion historiques
 * depuis le CSV "RSN_BD_AllMembers (Internal List)" vers Notion.
 *
 * IMPORTANT — Confidentialité:
 *   Les emails des membres sont reçus uniquement via POST body, traités
 *   en mémoire le temps de l'écriture vers Notion, puis oubliés. Aucune
 *   donnée personnelle n'est stockée dans le repo Git ni dans des logs
 *   persistants Vercel (sauf erreurs, qui ne contiennent que les emails
 *   en échec, sans les autres données).
 *
 * Côté client: le fichier data/membership-dates.js est gitignored et
 * reste sur la machine locale de l'admin. Le script scripts/post-dates-
 * to-vercel.js lit ce fichier et POST son contenu à cet endpoint.
 *
 * Idempotent: re-soumettre le même body écrase juste les dates avec les
 * mêmes valeurs.
 */
const { findByEmail, setMembershipDates } = require('../lib/notion');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const records = (req.body && Array.isArray(req.body.records)) ? req.body.records : null;
  if (!records) {
    return res.status(400).json({ error: 'Body must be { records: [{ email, dateDebut, dateRenouvellement }, ...] }' });
  }

  const results = {
    received: records.length,
    updated: 0,
    notFound: 0,
    failed: 0,
    notFoundEmails: [],
    errors: [],
  };

  for (const r of records) {
    const email = (r && r.email || '').toLowerCase().trim();
    if (!email) { results.failed++; continue; }
    try {
      const page = await findByEmail(email);
      if (!page) {
        results.notFound++;
        if (results.notFoundEmails.length < 50) results.notFoundEmails.push(email);
        continue;
      }
      await setMembershipDates(page.id, r.dateDebut, r.dateRenouvellement);
      results.updated++;
    } catch (err) {
      results.failed++;
      results.errors.push({ email, error: err.message });
      if (results.errors.length >= 5) break;
    }
  }

  return res.status(200).json({ ok: results.failed === 0, ...results });
};

module.exports.config = { maxDuration: 300 };
