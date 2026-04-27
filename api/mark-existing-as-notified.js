/**
 * GET /api/mark-existing-as-notified?key=YOUR_BACKUP_SECRET
 *
 * One-shot endpoint à appeler UNE SEULE FOIS avant le déploiement du cron
 * d'envoi automatique des emails d'acceptation.
 *
 * Parcourt tous les membres existants dans Notion et coche la propriété
 * "Email d'acceptation envoyé". Cela évite que le cron ne renvoie
 * accidentellement un email à tous les ~654 membres déjà acceptés depuis
 * longtemps.
 *
 * Idempotent : relancer ne pose aucun problème (cocher une box déjà cochée
 * est un no-op côté Notion).
 *
 * Une fois exécuté avec succès, ce fichier peut être supprimé du repo.
 */
const { getAllMembers, markAcceptanceEmailSent } = require('../lib/notion');

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const members = await getAllMembers();

    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];

    for (const m of members) {
      if (m.emailAccepteEnvoye) {
        skipped++;
        continue;
      }
      try {
        await markAcceptanceEmailSent(m.id);
        updated++;
      } catch (err) {
        failed++;
        errors.push({ id: m.id, name: `${m.prenom} ${m.nom}`, error: err.message });
        if (errors.length >= 5) break; // stop early on repeated failures
      }
    }

    return res.status(200).json({
      ok: failed === 0,
      total: members.length,
      updated,
      skipped,
      failed,
      errors,
    });
  } catch (err) {
    console.error('mark-existing-as-notified error:', err);
    return res.status(500).json({ error: 'Failed', message: err.message });
  }
};

module.exports.config = { maxDuration: 300 };
