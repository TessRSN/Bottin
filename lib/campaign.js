/**
 * Campagne « complétez votre profil » (2026-09-15) — logique partagée entre
 * le point d'entree d'administration (api/campaign.js) et le cron quotidien
 * (api/export.js, appele par Vercel a 7 h 30, heure du Québec).
 *
 * Segments (decision Tess) :
 *   A = fiche approuvee sans decision de partage public (consentement vide)
 *   B = fiche publique (consentement Oui) sans statut, sans axe ou sans theme
 * Jamais contactes : refus (consentement Non), fiches non approuvees, sans courriel.
 *
 * Garde-fous :
 *   - chaque envoi inscrit la date (Québec) dans « Courriel campagne profil » ;
 *     une fiche datee n'est plus jamais reprise ;
 *   - le plafond quotidien compte les envois deja faits aujourd'hui : rejouer
 *     la campagne dans la meme journee n'envoie que le reliquat ;
 *   - un budget de temps arrete la boucle avant la limite d'execution de la
 *     fonction ; le reste part a l'appel suivant ;
 *   - CAMPAIGN_PAUSED=true suspend le cron ; CAMPAIGN_DAILY_LIMIT change le
 *     plafond (defaut 40, choisi par Tess pour rester sous les 100/j de Resend).
 */
const { setMemberDate } = require('./notion');
const { signCampaignToken } = require('./token');
const { sendProfileCampaign } = require('./email');

const DEFAULT_DAILY_LIMIT = 40;
const PAUSE_BETWEEN_SENDS_MS = 600; // Resend : 2 requetes par seconde
const TYPE_ORDER = { 'Régulier': 0, 'Partenaire': 1, 'Étudiant': 2 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Date du jour au Québec (AAAA-MM-JJ), independante du fuseau du serveur.
function quebecTodayISO(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function segmentOf(m) {
  if (m.workflow !== 'Approuvé' || !m.email) return null;
  if (!m.consent) return 'A';
  if (m.consent === 'Oui' && (!m.statut || !(m.axes || []).length || !m.themes)) return 'B';
  return null;
}

function editUrl(pageId, email) {
  const baseUrl = process.env.BASE_URL || 'https://bottin.rsn.quebec';
  return `${baseUrl}/edit.html?token=${signCampaignToken(pageId, email)}`;
}

function sortForSending(a, b) {
  const ta = TYPE_ORDER[a.type] ?? 9, tb = TYPE_ORDER[b.type] ?? 9;
  if (ta !== tb) return ta - tb;
  return `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr');
}

function dailyLimit() {
  const v = parseInt(process.env.CAMPAIGN_DAILY_LIMIT || '', 10);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_DAILY_LIMIT;
}

/** Fiches restantes a contacter, par segment, et envois deja faits. */
function campaignStats(members) {
  const remaining = { A: 0, B: 0 };
  let alreadySent = 0, sentToday = 0;
  const today = quebecTodayISO();
  for (const m of members) {
    if (m.campagneProfil) { alreadySent++; if (m.campagneProfil === today) sentToday++; continue; }
    const s = segmentOf(m);
    if (s) remaining[s]++;
  }
  return { remaining, total: remaining.A + remaining.B, alreadySent, sentToday, today, dailyLimit: dailyLimit() };
}

/**
 * Envoie le prochain lot.
 * @param {object[]} members   sortie de getAllMembers()
 * @param {object}  opts       { segments: ['A','B'], limit, dryRun, timeBudgetMs, log }
 * @returns {object} { dryRun, limit, sentToday, selected, sent, failed, results, stoppedByTime }
 */
async function runProfileCampaign(members, opts = {}) {
  const segments = opts.segments || ['A', 'B'];
  const dryRun = opts.dryRun !== false;
  const timeBudgetMs = opts.timeBudgetMs || 40000;
  const log = opts.log || (() => {});
  const stats = campaignStats(members);
  const cap = Math.max(0, Math.min(opts.limit ?? stats.dailyLimit, 100));
  const room = Math.max(0, cap - stats.sentToday);
  const batch = members
    .filter(m => !m.campagneProfil && segments.includes(segmentOf(m)))
    .sort(sortForSending)
    .slice(0, room);
  const started = Date.now();
  const results = [];
  let stoppedByTime = false;
  for (const m of batch) {
    if (!dryRun && Date.now() - started > timeBudgetMs) { stoppedByTime = true; break; }
    const entry = { name: `${m.prenom} ${m.nom}`.trim(), email: m.email, segment: segmentOf(m), type: m.type };
    if (!dryRun) {
      try {
        await sendProfileCampaign(m.email, m.prenom || 'Membre', editUrl(m.id, m.email));
        await setMemberDate(m.id, 'campagneProfil', stats.today);
        entry.sent = true;
        log(`[campagne] envoye a ${m.email}`);
      } catch (err) {
        entry.sent = false; entry.error = err.message;
        log(`[campagne] echec pour ${m.email} : ${err.message}`);
      }
      await sleep(PAUSE_BETWEEN_SENDS_MS);
    }
    results.push(entry);
  }
  const sent = results.filter(r => r.sent).length;
  const failed = results.filter(r => r.sent === false).length;
  return { dryRun, segments, limit: cap, sentToday: stats.sentToday, remainingBefore: stats.remaining, selected: results.length, sent, failed, stoppedByTime, results };
}

module.exports = { runProfileCampaign, campaignStats, segmentOf, editUrl, quebecTodayISO };
