/**
 * GET /api/membership-report?key=YOUR_BACKUP_SECRET
 *
 * Retourne un rapport de qualite de la base Membres Notion. Aucune
 * modification - c'est uniquement un diagnostic a des fins admin.
 *
 * Issues detectees:
 *   - noEmail            : fiches sans email principal
 *   - noPrenom           : prenom vide
 *   - nomColle           : nom de famille vide ET prenom contient un
 *                          espace (probablement nom complet colle dans
 *                          la colonne prenom)
 *   - noInstitution      : institution vide
 *   - noType             : type d'adhesion vide
 *   - noDate             : date de debut d'adhesion vide
 *   - dateRenouvDifferent: date renouv. != date debut + 2 ans
 */
const { getAllMembers } = require('../lib/notion');

function expectedRenewal(dateDebutISO) {
  if (!dateDebutISO) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateDebutISO);
  if (!m) return null;
  return `${parseInt(m[1], 10) + 2}-${m[2]}-${m[3]}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const all = await getAllMembers();

    const summary = (m) => ({
      id: m.id,
      prenom: m.prenom,
      nom: m.nom,
      email: m.email,
    });

    const issues = {
      noEmail: [],
      noPrenom: [],
      nomColle: [],
      noInstitution: [],
      noType: [],
      noDate: [],
      dateRenouvDifferent: [],
    };

    const allEmails = new Set();

    for (const m of all) {
      const isEmpty = !m.prenom && !m.nom && !m.email;
      if (isEmpty) continue;

      if (!m.email) issues.noEmail.push(summary(m));
      else allEmails.add(m.email.toLowerCase().trim());

      if (m.email2) allEmails.add(m.email2.toLowerCase().trim());

      if (!m.prenom) issues.noPrenom.push(summary(m));

      if (!m.nom && m.prenom && m.prenom.trim().includes(' ')) {
        issues.nomColle.push(summary(m));
      }

      if (!m.institution) issues.noInstitution.push(summary(m));
      if (!m.type) issues.noType.push(summary(m));

      if (!m.dateDebut) {
        issues.noDate.push(summary(m));
      } else {
        const expected = expectedRenewal(m.dateDebut);
        if (expected && m.dateRenouvellement && m.dateRenouvellement !== expected) {
          issues.dateRenouvDifferent.push({
            ...summary(m),
            dateDebut: m.dateDebut,
            dateRenouvellement: m.dateRenouvellement,
            expected,
          });
        }
      }
    }

    const counts = {};
    for (const k of Object.keys(issues)) counts[k] = issues[k].length;

    return res.status(200).json({
      ok: true,
      totalMembers: all.length,
      counts,
      issues,
      allEmails: Array.from(allEmails).sort(),
    });
  } catch (err) {
    console.error('membership-report error:', err);
    return res.status(500).json({ error: 'Failed', message: err.message });
  }
};

module.exports.config = { maxDuration: 60 };
