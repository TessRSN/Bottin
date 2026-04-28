/**
 * POST /api/recreate-forgotten?key=YOUR_BACKUP_SECRET
 * Body: { records: [{ prenom, nom, email, email2, statut, institution,
 *                     type, reseau, expertise, themes, projet,
 *                     etudiants, refere, orcid, cv, consent,
 *                     axes[], principes[], champs[],
 *                     dateDebut, dateRenouvellement }, ...] }
 *
 * Recree les fiches Notion oubliees lors de l'import initial. Pour
 * chaque record:
 *   1. Verifie qu'aucun email (primaire ou secondaire) n'existe deja
 *      dans Notion (sinon skip pour ne pas creer de doublon)
 *   2. Cree la fiche en statut workflow="Nouveau"
 *   3. Marque emailAccepteEnvoye=true pour eviter que le cron
 *      d'acceptation envoie un email a ces membres recrees
 *
 * Confidentialite: les donnees personnelles sont recues via POST body
 * uniquement, traitees en memoire le temps de l'ecriture vers Notion,
 * puis oubliees. Aucun stockage durable cote Vercel ni dans le repo.
 */
const { findByEmail, createMember } = require('../lib/notion');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const records = (req.body && Array.isArray(req.body.records)) ? req.body.records : null;
  if (!records) {
    return res.status(400).json({ error: 'Body must be { records: [...] }' });
  }

  const results = {
    received: records.length,
    created: 0,
    skippedExisting: 0,
    failed: 0,
    skippedReasons: [],
    errors: [],
  };

  for (const r of records) {
    const email = (r && r.email || '').toLowerCase().trim();
    const email2 = (r && r.email2 || '').toLowerCase().trim();
    if (!email) { results.failed++; continue; }
    try {
      // Don't recreate if any of the emails is already in Notion
      const existing = await findByEmail(email);
      if (existing) {
        results.skippedExisting++;
        results.skippedReasons.push(`${email} (primary already exists)`);
        continue;
      }
      if (email2) {
        const existing2 = await findByEmail(email2);
        if (existing2) {
          results.skippedExisting++;
          results.skippedReasons.push(`${email} (secondary ${email2} already exists)`);
          continue;
        }
      }

      await createMember({
        prenom: r.prenom,
        nom: r.nom,
        email,
        email2: email2 || null,
        statut: r.statut,
        institution: r.institution,
        type: r.type,
        reseau: r.reseau,
        expertise: r.expertise,
        themes: r.themes,
        projet: r.projet,
        etudiants: r.etudiants,
        refere: r.refere,
        orcid: r.orcid || null,
        cv: r.cv || null,
        consent: r.consent,
        axes: Array.isArray(r.axes) ? r.axes : [],
        principes: Array.isArray(r.principes) ? r.principes : [],
        champs: Array.isArray(r.champs) ? r.champs : [],
        dateDebut: r.dateDebut || null,
        dateRenouvellement: r.dateRenouvellement || null,
        emailAccepteEnvoye: true, // never send acceptance email for recreated members
      });
      results.created++;
    } catch (err) {
      results.failed++;
      results.errors.push({ email, error: err.message });
      if (results.errors.length >= 5) break;
    }
  }

  return res.status(200).json({ ok: results.failed === 0, ...results });
};

module.exports.config = { maxDuration: 300 };
