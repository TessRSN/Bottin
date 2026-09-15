/**
 * Campagne « complétez votre profil » (2026-09-15) — point d'entree d'administration.
 * Logique partagee dans lib/campaign.js ; l'envoi quotidien automatique est
 * fait par le cron de /api/export (7 h 30, heure du Québec).
 *
 * Protege par BACKUP_SECRET (?key=), GET ou POST. Actions (?action=) :
 *   stats                         fiches restantes par segment, envois faits, plafond du jour
 *   test&to=<courriel>            envoie le courriel a cette adresse, avec le lien de
 *                                 modification (30 jours) de la fiche qui porte ce courriel
 *   send&segment=A|B|AB&limit=40&dryRun=1|0
 *                                 envoie le prochain lot (reliquat du plafond du jour) ;
 *                                 dryRun=1 (defaut) liste sans envoyer
 */
const { getAllMembers, findByEmail } = require('../lib/notion');
const { sendProfileCampaign } = require('../lib/email');
const { runProfileCampaign, campaignStats, editUrl } = require('../lib/campaign');

module.exports.config = { maxDuration: 60 };

module.exports = async function handler(req, res) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const q = Object.assign({}, req.query || {}, body);
  if (!q.key || q.key !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const action = String(q.action || 'stats');

  try {
    if (action === 'test') {
      const to = String(q.to || '').trim().toLowerCase();
      if (!to) return res.status(400).json({ error: 'Parametre "to" requis' });
      const page = await findByEmail(to);
      if (!page) return res.status(404).json({ error: 'Aucune fiche pour ce courriel' });
      const prenom = page.properties['Prénom']?.title?.[0]?.plain_text || 'Membre';
      await sendProfileCampaign(to, prenom, editUrl(page.id, to));
      return res.status(200).json({ ok: true, sentTo: to, prenom, linkValidDays: 30 });
    }

    const members = await getAllMembers();

    if (action === 'stats') {
      return res.status(200).json({ ok: true, paused: process.env.CAMPAIGN_PAUSED === 'true', ...campaignStats(members) });
    }

    if (action === 'send') {
      const segment = String(q.segment || 'AB').toUpperCase();
      const segments = segment === 'AB' ? ['A', 'B'] : [segment];
      const limit = q.limit !== undefined ? parseInt(q.limit, 10) : undefined;
      const dryRun = !(q.dryRun === '0' || q.dryRun === 0 || q.dryRun === false || q.dryRun === 'false');
      const result = await runProfileCampaign(members, { segments, limit, dryRun, timeBudgetMs: 45000, log: console.log });
      return res.status(200).json({ ok: true, ...result });
    }

    return res.status(400).json({ error: 'Action inconnue : ' + action });
  } catch (err) {
    console.error('[campaign] erreur :', err);
    return res.status(500).json({ error: err.message });
  }
};
