/**
 * GET /api/export
 * Exports all members from Notion → CSV format
 * Applies consent rules identical to prepare_public_csv.py
 *
 * Called by Vercel cron daily or on-demand
 *
 * Référencement (2026-11) — deux autres sorties publiques, sur la même fonction
 * parce que le projet est au plafond de 12 fonctions (voir vercel.json) :
 *   GET /membre/<slug>  → /api/export?view=membre&slug=<slug> : page de profil
 *   GET /sitemap.xml    → /api/export?view=sitemap           : plan de site
 * Ni l'une ni l'autre n'envoie de courriel ni n'écrit dans Notion.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  getAllMembers, getAllInstitutions, markAcceptanceEmailSent,
  setMemberCheckbox, archiveMemberPage,
  findApprovedMembersByName, getInstitutionNames,
  CSV_COL,
} = require('../lib/notion');
const {
  isPublicMember, assignSlugs, isValidSlug, slugLookupTokens,
  renderMemberPage, renderNotFoundPage, renderSitemap,
} = require('../lib/public-page');
const {
  sendAcceptanceEmail,
  sendRenewalReminder60j, sendRenewalReminder30j,
  sendArchiveNotification, sendAdminRetentionRecap,
} = require('../lib/email');
const { signRenewalToken } = require('../lib/token');
const { runProfileCampaign } = require('../lib/campaign');

// Le cron enchaine export, courriels d'acceptation, retention et campagne :
// jusqu'a une minute. Un chargement de page normal reste court (pas de campagne).
module.exports.config = { maxDuration: 60 };

// ─── RETENTION CRON ────────────────────────────────────────────────
// 60 days before renewal → email 1 + flag emailRenouv60jEnvoye
// 30 days before renewal → email 2 + flag emailRenouv30jEnvoye
// Day J (or after)        → archive page + email 4 + flag emailArchivageEnvoye
// Daily admin recap        → list of fiches that will be archived within 7 days
//
// Three safety locks (env vars):
//   RETENTION_EMAILS_ENABLED       must be "true" (default: dry-run, logs only)
//   RETENTION_EMAILS_TEST_RECIPIENTS  if set, only these emails actually receive
//   RETENTION_EMAILS_DAILY_LIMIT   max emails per cron run (default 30)

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysBetween(fromISO, toISO) {
  const a = new Date(fromISO + 'T00:00:00Z');
  const b = new Date(toISO + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}
function fullName(m) {
  return `${(m.prenom || '').trim()} ${(m.nom || '').trim()}`.trim() || 'Membre';
}

async function runRetentionCron(allMembers, availableBudget) {
  const enabled = process.env.RETENTION_EMAILS_ENABLED === 'true';
  // Phase 2k (2026-05-16) : si un budget partagé est fourni par l'appelant
  // (cron principal), il borne le plafond. Sinon (appel autonome ou test),
  // on retombe sur RETENTION_EMAILS_DAILY_LIMIT (défaut 30).
  // 2026-09-28 : le budget partagé ne remplace plus RETENTION_EMAILS_DAILY_LIMIT,
  // il le borne. Du 25 au 27 septembre, la vague des rappels 60 j avait pris
  // tout le budget (~95/jour) au lieu de 30, et les envois en temps réel de la
  // journée (confirmations de renouvellement, liens magiques) dépassaient les
  // 100/jour de Resend.
  const ownLimit = parseInt(process.env.RETENTION_EMAILS_DAILY_LIMIT || '30', 10);
  const dailyLimit = (typeof availableBudget === 'number' && availableBudget >= 0)
    ? Math.min(availableBudget, ownLimit)
    : ownLimit;
  const testRecipientsEnv = (process.env.RETENTION_EMAILS_TEST_RECIPIENTS || '').trim();
  const testRecipients = testRecipientsEnv ? testRecipientsEnv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : null;
  const adminRecipients = (process.env.ADMIN_NOTIFICATION_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);
  const today = todayISO();
  const baseUrl = process.env.BASE_URL || 'https://bottin.rsn.quebec';

  const stats = {
    enabled,
    dailyLimit,
    testRecipients: testRecipients || null,
    today,
    candidates60j: 0,
    candidates30j: 0,
    candidatesArchive: 0,
    sent60j: 0,
    sent30j: 0,
    sentArchive: 0,
    archivedPages: 0,
    skippedTestList: 0,
    upcoming7d: 0,
    failed: 0,
    errors: [],
  };

  // Only consider real members (with valid email + renewal date + not already archived).
  // Phase 2k (2026-05-12) : exclure aussi "Nouveau" et "On Hold" — ces fiches
  // sont en attente de validation et ne doivent pas declencher de cycle de
  // renouvellement automatique tant qu'elles n'ont pas ete approuvees.
  const eligible = allMembers.filter(m =>
    m.email && m.email.includes('@') &&
    m.dateRenouvellement &&
    m.workflow !== 'Refusé' &&
    m.workflow !== 'Nouveau' &&
    m.workflow !== 'On Hold'
  );

  // Categorize each eligible member by what action is due TODAY.
  const todoArchive = [];
  const todo30j = [];
  const todo60j = [];
  const upcoming7d = [];

  for (const m of eligible) {
    const delta = daysBetween(today, m.dateRenouvellement);
    if (delta <= 0 && !m.emailArchivageEnvoye) {
      todoArchive.push(m);
    } else if (delta > 0 && delta <= 30 && !m.emailRenouv30jEnvoye) {
      todo30j.push(m);
    } else if (delta > 30 && delta <= 60 && !m.emailRenouv60jEnvoye) {
      todo60j.push(m);
    }
    if (delta > 0 && delta <= 7) upcoming7d.push(m);
  }

  stats.candidatesArchive = todoArchive.length;
  stats.candidates30j = todo30j.length;
  stats.candidates60j = todo60j.length;
  stats.upcoming7d = upcoming7d.length;

  // Dry-run: log only, don't send anything
  if (!enabled) {
    console.log('[retention] DISABLED (RETENTION_EMAILS_ENABLED ≠ "true")');
    console.log(`[retention] Would have processed: archive=${todoArchive.length} 30j=${todo30j.length} 60j=${todo60j.length} upcoming7d=${upcoming7d.length}`);
    return stats;
  }

  // Helper: should we actually send to this email?
  function shouldSendTo(email) {
    if (!testRecipients) return true; // no whitelist → send to everyone
    return testRecipients.includes(email.toLowerCase().trim());
  }

  // Order matters: archive first (most urgent), then 30j, then 60j.
  // Each respects the daily limit shared across all categories.
  let budget = dailyLimit;

  // Archive (oldest expirations first to be deterministic)
  todoArchive.sort((a, b) => a.dateRenouvellement.localeCompare(b.dateRenouvellement));
  for (const m of todoArchive) {
    if (budget <= 0) break;
    try {
      if (shouldSendTo(m.email)) {
        await sendArchiveNotification(m.email, m.prenom || fullName(m));
        stats.sentArchive++;
      } else {
        stats.skippedTestList++;
      }
      // Even in test mode, we mark the checkbox AND archive the page.
      // (The test mode only restricts who actually receives the email; the
      //  retention logic itself runs through.)
      await setMemberCheckbox(m.id, 'emailArchivageEnvoye', true);
      await archiveMemberPage(m.id);
      stats.archivedPages++;
      budget--;
      console.log(`[retention] Archived ${m.email} (renouv ${m.dateRenouvellement})`);
    } catch (err) {
      stats.failed++;
      stats.errors.push({ stage: 'archive', email: m.email, error: err.message });
    }
  }

  // 30-day reminders
  todo30j.sort((a, b) => a.dateRenouvellement.localeCompare(b.dateRenouvellement));
  for (const m of todo30j) {
    if (budget <= 0) break;
    try {
      const token = signRenewalToken(m.id, m.email);
      const url = `${baseUrl}/renew.html?token=${token}`;
      if (shouldSendTo(m.email)) {
        await sendRenewalReminder30j(m.email, m.prenom || fullName(m), m.dateRenouvellement, url);
        stats.sent30j++;
      } else {
        stats.skippedTestList++;
      }
      await setMemberCheckbox(m.id, 'emailRenouv30jEnvoye', true);
      budget--;
      console.log(`[retention] 30j reminder to ${m.email}`);
    } catch (err) {
      stats.failed++;
      stats.errors.push({ stage: '30j', email: m.email, error: err.message });
    }
  }

  // 60-day reminders
  todo60j.sort((a, b) => a.dateRenouvellement.localeCompare(b.dateRenouvellement));
  for (const m of todo60j) {
    if (budget <= 0) break;
    try {
      const token = signRenewalToken(m.id, m.email);
      const url = `${baseUrl}/renew.html?token=${token}`;
      if (shouldSendTo(m.email)) {
        await sendRenewalReminder60j(m.email, m.prenom || fullName(m), m.dateRenouvellement, url);
        stats.sent60j++;
      } else {
        stats.skippedTestList++;
      }
      await setMemberCheckbox(m.id, 'emailRenouv60jEnvoye', true);
      budget--;
      console.log(`[retention] 60j reminder to ${m.email}`);
    } catch (err) {
      stats.failed++;
      stats.errors.push({ stage: '60j', email: m.email, error: err.message });
    }
  }

  // Daily admin recap (only if there are upcoming archivals AND we have admin recipients)
  if (upcoming7d.length > 0 && adminRecipients.length > 0) {
    try {
      // Safe-guard: in test mode, send admin recap only to test recipients
      const recipients = testRecipients
        ? adminRecipients.filter(r => testRecipients.includes(r.toLowerCase()))
        : adminRecipients;
      if (recipients.length > 0) {
        const list = upcoming7d.map(m => ({ name: fullName(m), email: m.email, dateRenouvellement: m.dateRenouvellement }));
        await sendAdminRetentionRecap(recipients, list);
        console.log(`[retention] Admin recap sent to ${recipients.join(', ')} (${list.length} fiches)`);
      }
    } catch (err) {
      stats.failed++;
      stats.errors.push({ stage: 'admin-recap', error: err.message });
    }
  }

  console.log(`[retention] Done. Sent: archive=${stats.sentArchive} 30j=${stats.sent30j} 60j=${stats.sent60j} | Archived: ${stats.archivedPages} | Test-skipped: ${stats.skippedTestList} | Failed: ${stats.failed}`);
  return stats;
}

module.exports.runRetentionCron = runRetentionCron;

// Vercel serverless config
module.exports.config = { maxDuration: 60 };

// CSV headers in exact order expected by index.html
const HEADERS = [
  CSV_COL.prenom, CSV_COL.nom, CSV_COL.email, CSV_COL.email2,
  CSV_COL.statut, CSV_COL.institution, CSV_COL.type, CSV_COL.reseau,
  CSV_COL.themes,
  CSV_COL.axe1, CSV_COL.axe2, CSV_COL.axe3, CSV_COL.axe4,
  CSV_COL.pf1, CSV_COL.pf2, CSV_COL.pf3, CSV_COL.pf4, CSV_COL.pf5,
  CSV_COL.ca1, CSV_COL.ca2, CSV_COL.ca3,
  CSV_COL.projet, CSV_COL.etudiants, CSV_COL.refere, CSV_COL.droitVote,
  CSV_COL.orcid, CSV_COL.cv, CSV_COL.evaluateur, CSV_COL.consent,
  CSV_COL.photo, // Phase 3a: adresse du relais photo (ajoutee en fin, index.html lit par nom)
  CSV_COL.nouveaute, // Refonte 2026-11 : « nouveau » ou « maj » (ajoutee en fin, index.html lit par nom)
  CSV_COL.slug, // Referencement 2026-11 : fin de l'adresse /membre/<slug> (ajoutee en fin, index.html lit par nom)
];

// Refonte 2026-11 : mention affichee sur les fiches pour mettre en avant les
// nouveaux membres et les profils recemment mis a jour. Seule la mention est
// publiee, jamais la date. « nouveau » = fiche creee depuis moins de
// NOUVEAU_JOURS ; « maj » = profil modifie par le membre depuis moins de MAJ_JOURS.
const NOUVEAU_JOURS = 15; // durees choisies par Tess le 2026-11-21
const MAJ_JOURS = 15;
function nouveauteOf(m) {
  const jours = d => { const t = d ? new Date(d).getTime() : NaN; return isNaN(t) ? Infinity : (Date.now() - t) / 86400000; };
  if (jours(m.creeLe) <= NOUVEAU_JOURS) return 'nouveau';
  if (jours(m.profilModifie) <= MAJ_JOURS) return 'maj';
  return '';
}

// Sensitive columns masked for pending members
const PLACEHOLDER = {
  [CSV_COL.email]: 'membre@rsn-placeholder.ca',
  [CSV_COL.institution]: 'Institution non divulguée',
  [CSV_COL.statut]: 'Non divulgué',
};

function escapeCSV(val) {
  const s = String(val || '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function memberToCSVRow(m, consent) {
  // Expand multi-select arrays back to numbered columns
  const axes = Array.isArray(m.axes) ? m.axes : [];
  const principes = Array.isArray(m.principes) ? m.principes : [];
  const champs = Array.isArray(m.champs) ? m.champs : [];

  // Phase 2f (2026-05-04):
  //  - Email principal : visible sauf si toggle 'afficherCourriel' = false.
  //    On utilise '!== false' (et pas '=== true') pour la retro-compatibilite :
  //    pendant la fenetre entre deploiement code et migration de la base,
  //    les fiches existantes peuvent encore avoir undefined → traite comme
  //    visible (default safe, statu quo avant la fonctionnalite).
  //    La migration met explicitement true pour tous les consent=Oui actuels,
  //    et les nouveaux membres ont la valeur du toggle (default true coche).
  //  - Email secondaire : JAMAIS dans le CSV public (canal admin uniquement).
  const showEmail = m.afficherCourriel !== false;

  const row = {
    [CSV_COL.prenom]: m.prenom,
    [CSV_COL.nom]: m.nom,
    [CSV_COL.email]: showEmail ? m.email : '',
    [CSV_COL.email2]: '',
    [CSV_COL.statut]: m.statut,
    [CSV_COL.institution]: m.institution,
    [CSV_COL.type]: m.type,
    [CSV_COL.reseau]: m.reseau,
    [CSV_COL.themes]: m.themes,
    [CSV_COL.axe1]: axes[0] || '',
    [CSV_COL.axe2]: axes[1] || '',
    [CSV_COL.axe3]: axes[2] || '',
    [CSV_COL.axe4]: axes[3] || '',
    [CSV_COL.pf1]: principes[0] || '',
    [CSV_COL.pf2]: principes[1] || '',
    [CSV_COL.pf3]: principes[2] || '',
    [CSV_COL.pf4]: principes[3] || '',
    [CSV_COL.pf5]: principes[4] || '',
    [CSV_COL.ca1]: champs[0] || '',
    [CSV_COL.ca2]: champs[1] || '',
    [CSV_COL.ca3]: champs[2] || '',
    [CSV_COL.projet]: m.projet,
    [CSV_COL.etudiants]: m.etudiants,
    [CSV_COL.refere]: m.refere,
    [CSV_COL.droitVote]: m.droitVote ? 'Oui' : '',
    [CSV_COL.orcid]: m.orcid,
    [CSV_COL.cv]: m.cv,
    [CSV_COL.evaluateur]: m.evaluateur,
    [CSV_COL.consent]: consent,
    // Phase 3a: la photo passe par /api/photo (les urls Notion expirent) ;
    // v = nom horodate du fichier => nouvelle photo, nouvelle adresse, cache CDN invalide.
    [CSV_COL.photo]: m.photoName
      ? `/api/photo?id=${String(m.id).replace(/-/g, '')}&v=${encodeURIComponent(m.photoName)}`
      : '',
    [CSV_COL.nouveaute]: nouveauteOf(m),
    // Pose par assignSlugs sur les seuls membres publics ; vide pour les autres.
    [CSV_COL.slug]: m.slug || '',
  };

  return row;
}

function maskSensitive(row) {
  // Mask personal data but keep structural fields
  const sensitive = [
    CSV_COL.email, CSV_COL.email2, CSV_COL.statut, CSV_COL.institution,
    CSV_COL.reseau, CSV_COL.themes, CSV_COL.projet,
    CSV_COL.etudiants, CSV_COL.refere, CSV_COL.orcid, CSV_COL.cv,
    CSV_COL.evaluateur, CSV_COL.photo, CSV_COL.nouveaute, CSV_COL.slug,
  ];
  for (const col of sensitive) {
    row[col] = PLACEHOLDER[col] || '';
  }
  return row;
}

// ─── PAGE DE PROFIL (/membre/<slug>) ───────────────────────────────
// index.html est joint a la fonction par « includeFiles » dans vercel.json.
// Il ne change pas pendant la vie d'un deploiement : lu une fois par instance.
let indexHtmlCache = null;
async function loadIndexHtml(req) {
  if (indexHtmlCache) return indexHtmlCache;
  for (const file of [path.join(__dirname, '..', 'index.html'), path.join(process.cwd(), 'index.html')]) {
    try {
      const html = fs.readFileSync(file, 'utf8');
      if (html.includes('id="memberOverlay"')) { indexHtmlCache = html; return html; }
    } catch (err) { /* essai suivant */ }
  }
  // Secours si le fichier n'a pas ete joint : la page servie par le site lui-meme.
  const host = String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '');
  if (host === 'bottin.rsn.quebec' || /^[a-z0-9-]+\.vercel\.app$/.test(host)) {
    const r = await fetch(`https://${host}/index.html`);
    const html = r.ok ? await r.text() : '';
    if (html.includes('id="memberOverlay"')) { indexHtmlCache = html; return html; }
  }
  throw new Error('index.html introuvable');
}

// Lecture complete gardee quelques minutes par instance : elle ne sert qu'au
// secours de findPublicMemberBySlug, et evite qu'une serie d'adresses
// inexistantes relise tout Notion a chaque fois.
let allPublicCache = { at: 0, list: null };
async function allPublicMembers() {
  if (allPublicCache.list && Date.now() - allPublicCache.at < 5 * 60 * 1000) return allPublicCache.list;
  const list = assignSlugs((await getAllMembers()).filter(isPublicMember));
  allPublicCache = { at: Date.now(), list };
  return list;
}

// Retrouve le membre public d'un slug. D'abord par une recherche sur le nom
// (une requete Notion, ~0,2 s) ; si elle ne donne rien (nom d'un seul mot,
// caractere que Notion ne rapproche pas), par la lecture complete (~3 s).
async function findPublicMemberBySlug(slug) {
  const tokens = slugLookupTokens(slug);
  if (tokens) {
    const found = assignSlugs((await findApprovedMembersByName(tokens.first, tokens.last)).filter(isPublicMember))
      .find(m => m.slug === slug);
    if (found) return found;
  }
  return (await allPublicMembers()).find(m => m.slug === slug) || null;
}

async function serveMemberPage(req, res) {
  let indexHtml;
  try {
    indexHtml = await loadIndexHtml(req);
  } catch (err) {
    console.error('[membre] ' + err.message);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', '/');
    return res.status(302).end();
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    const slug = String((req.query && req.query.slug) || '').toLowerCase();
    const member = isValidSlug(slug) ? await findPublicMemberBySlug(slug) : null;
    if (!member) {
      // Pas (ou plus) de profil public a cette adresse : 404, pour que les
      // moteurs retirent la page. Le visiteur voit l'accueil du bottin.
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
      return res.status(404).send(renderNotFoundPage(indexHtml));
    }
    // Meme regle que l'export : le nom des etablissements lies prime sur le champ texte.
    if (member.institutionIds && member.institutionIds.length) {
      const names = await getInstitutionNames(member.institutionIds);
      if (names.length) member.institution = names.join('; ');
    }
    const page = renderMemberPage(indexHtml, member);
    if (page.missing.length) console.error('[membre] Repères absents de index.html : ' + page.missing.join(', '));
    // Gardee par le CDN 2 minutes, puis servie encore 5 minutes pendant qu'elle
    // se rafraichit : un retrait de consentement disparait d'ici au plus 7 minutes.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=300');
    return res.status(200).send(page.html);
  } catch (err) {
    // Notion indisponible, etc. : la page d'accueil telle quelle, qui ouvrira
    // la fiche elle-meme une fois ses donnees chargees.
    console.error('[membre] Erreur :', err.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(indexHtml);
  }
}

module.exports = async function handler(req, res) {
  const handlerStart = Date.now(); // sert au budget de temps de la campagne (maxDuration 60 s)
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const view = String((req.query && req.query.view) || '');
  if (view === 'membre') return serveMemberPage(req, res);

  try {
    const members = await getAllMembers();

    // Phase 2k (2026-05-16) : prioriser la relation "Institution liée"
    // (Notion DB Institutions) sur le champ texte legacy "Institution /
    // organisation 1" pour le rendu du bottin.
    //
    // Avantages :
    // - Renommer une institution dans la DB Institutions se reflète
    //   automatiquement sur le bottin (avant : fallait éditer chaque fiche
    //   membre une par une parce que le bottin lisait le champ texte qui ne
    //   bougeait pas quand on renommait l'institution).
    // - Les coordonnées GEOCODE pointent sur le nom canonique, donc plus de
    //   marqueurs "perdus" après un renommage.
    //
    // Fallback : si la relation est vide pour un membre (vieille fiche pas
    // encore migrée), on garde son champ texte existant.
    try {
      const institutions = await getAllInstitutions();
      const instMap = Object.fromEntries(institutions.map(i => [i.id, i.name]));
      let resolved = 0;
      for (const m of members) {
        if (!m.institutionIds || m.institutionIds.length === 0) continue;
        const canonical = m.institutionIds.map(id => instMap[id]).filter(Boolean);
        if (canonical.length > 0) {
          m.institution = canonical.join('; ');
          resolved++;
        }
      }
      console.log(`[export] Institutions resolved via relation: ${resolved}/${members.length} members`);
    } catch (err) {
      // En cas d'erreur (Notion down sur la DB Institutions), on log et on
      // continue avec le champ texte — le bottin reste fonctionnel.
      console.error('[export] Failed to resolve institution relation:', err.message);
    }

    // Referencement : adresse de la fiche de chaque membre public (colonne « Slug »).
    const publicMembers = assignSlugs(members.filter(isPublicMember));

    // Plan de site : sorti ici, avant l'export CSV et les courriels du cron.
    if (view === 'sitemap') {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).send(renderSitemap(publicMembers));
    }

    const publicRows = [];
    const pendingRows = [];
    const excludedStats = { total: 0, regulier: 0, etudiant: 0, partenaire: 0 };

    for (const m of members) {
      // Skip empty entries
      if (!m.prenom && !m.nom) continue;

      // Phase 2k (2026-05-11) — bug fix : ne pas exposer publiquement les fiches
      // qui n'ont pas encore ete approuvees par l'admin (workflow="Nouveau",
      // "Refuse", etc.). Seules les fiches "Approuve" doivent apparaitre sur
      // le bottin public. Sans ce filtre, les nouveaux candidats etaient
      // affiches immediatement, avant validation manuelle.
      if (m.workflow !== 'Approuvé') continue;

      const consent = (m.consent || '').toLowerCase();
      const typeNorm = (m.type || '').toLowerCase();

      if (consent.startsWith('oui')) {
        publicRows.push(memberToCSVRow(m, 'Oui'));
      } else if (consent.startsWith('non')) {
        excludedStats.total++;
        if (typeNorm.includes('régulier') || typeNorm.includes('regulier')) excludedStats.regulier++;
        else if (typeNorm.includes('étudiant') || typeNorm.includes('etudiant')) excludedStats.etudiant++;
        else if (typeNorm.includes('partenaire')) excludedStats.partenaire++;
      } else {
        // Pending — mask sensitive data
        const row = memberToCSVRow(m, '');
        pendingRows.push(maskSensitive(row));
      }
    }

    // Stats row for excluded members
    const statsRow = {};
    for (const h of HEADERS) statsRow[h] = '';
    statsRow[CSV_COL.prenom] = '__STATS_EXCLUDED__';
    statsRow[CSV_COL.email] = `${excludedStats.total},${excludedStats.regulier},${excludedStats.etudiant},${excludedStats.partenaire}`;
    statsRow[CSV_COL.consent] = 'stats';

    // Sort by last name then first name (use prenom as fallback if nom is empty)
    const sortByName = (a, b) => {
      const aNom = a[CSV_COL.nom] || a[CSV_COL.prenom] || '';
      const bNom = b[CSV_COL.nom] || b[CSV_COL.prenom] || '';
      const cmp = aNom.localeCompare(bNom, 'fr');
      return cmp !== 0 ? cmp : (a[CSV_COL.prenom] || '').localeCompare(b[CSV_COL.prenom] || '', 'fr');
    };
    publicRows.sort(sortByName);
    pendingRows.sort(sortByName);

    // Build CSV
    const allRows = [...publicRows, ...pendingRows, statsRow];
    const lines = [HEADERS.map(escapeCSV).join(',')];
    for (const row of allRows) {
      lines.push(HEADERS.map(h => escapeCSV(row[h])).join(','));
    }
    const csv = lines.join('\n');

    // Generate ETag from content so clients can skip re-download when nothing changed
    const etag = '"' + crypto.createHash('md5').update(csv).digest('hex') + '"';

    // If the client's cached version matches the current content, return 304 (no body)
    const ifNoneMatch = req.headers['if-none-match'];
    // Le CSV alimente la page ; les moteurs doivent pouvoir le lire pour
    // afficher le bottin, mais pas le proposer comme resultat de recherche.
    res.setHeader('X-Robots-Tag', 'noindex');
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      return res.status(304).end();
    }

    // ─── Courriels automatiques : uniquement quand Vercel appelle cet endpoint
    // par le cron (7 h 30, heure du Québec), jamais sur un chargement de page.
    //
    // 2026-09-30 : les acceptations et les rappels de renouvellement tournaient
    // à chaque export servi (chaque visite sans cache à jour), avec un budget
    // neuf à chaque passage. Du 25 au 28 septembre, avec 418 rappels 60 j en
    // attente et l'affluence de la campagne, la routine est repartie à chaque
    // chargement : ~100 rappels par jour acceptés par Resend, le reste refusé
    // puis renvoyé au passage suivant, les courriels en temps réel refusés
    // toute la journée, et les visiteurs qui attendaient la fin des envois
    // avant de recevoir l'export. Désormais un seul passage par jour, comme la
    // campagne. Conséquence : un courriel d'acceptation part le lendemain
    // matin de l'approbation dans Notion.
    //
    // Budget global EMAIL_DAILY_BUDGET (défaut 70 depuis le 2026-09-28 :
    // 30 rétention + 40 campagne, ~30 gardés pour les liens magiques et les
    // confirmations de renouvellement sous la limite Resend de 100/jour),
    // consommé dans l'ordre : acceptations, rétention, campagne. Le reste est
    // reporté au cron du lendemain (idempotent : cases et dates dans Notion).
    const isCron = /^vercel-cron/i.test(String(req.headers['user-agent'] || ''));
    const dailyBudget = parseInt(process.env.EMAIL_DAILY_BUDGET || '70', 10);
    let remainingBudget = dailyBudget;
    let retentionStats = null;

    if (isCron) {
      // Acceptations des fiches passées en « Approuvé » (idempotent via la case).
      let emailsSent = 0;
      let emailsFailed = 0;
      let emailsSkippedBudget = 0;
      for (const m of members) {
        if (m.workflow !== 'Approuvé') continue;
        if (m.emailAccepteEnvoye) continue;
        if (!m.email || !m.prenom) continue;
        if (remainingBudget <= 0) {
          emailsSkippedBudget++;
          continue;
        }
        try {
          // Phase 2h (2026-05-04): on passe le type d'adhesion pour personnaliser
          // le bandeau "Vous etes actuellement inscrit·e comme..." en haut du courriel.
          await sendAcceptanceEmail(m.email, m.prenom, m.type);
          await markAcceptanceEmailSent(m.id);
          emailsSent++;
          remainingBudget--;
          console.log(`[export] Acceptance email sent to ${m.email}`);
        } catch (err) {
          emailsFailed++;
          console.error(`[export] Failed to send acceptance email to ${m.email}:`, err.message);
        }
      }
      if (emailsSent > 0 || emailsFailed > 0 || emailsSkippedBudget > 0) {
        console.log(`[export] Acceptance emails: ${emailsSent} sent, ${emailsFailed} failed, ${emailsSkippedBudget} reportés. Budget restant: ${remainingBudget}/${dailyBudget}`);
      }

      // Rappels de renouvellement et archivage (Phase 3, Loi 25). Le budget
      // restant borne RETENTION_EMAILS_DAILY_LIMIT (30 par défaut).
      try {
        retentionStats = await runRetentionCron(members, remainingBudget);
      } catch (retErr) {
        console.error('[retention] Top-level error:', retErr.message, retErr.stack);
      }
    }

    // Campagne « complétez votre profil » (2026-09-15).
    // Plafond 40/jour (CAMPAIGN_DAILY_LIMIT), dans le budget courriel restant ;
    // CAMPAIGN_PAUSED=true suspend. Idempotent par jour (dates dans Notion).
    if (isCron && process.env.CAMPAIGN_PAUSED !== 'true') {
      try {
        const rs = retentionStats || {};
        const sentByRetention = (rs.sentArchive || 0) + (rs.sent30j || 0) + (rs.sent60j || 0);
        const budgetLeft = Math.max(0, remainingBudget - sentByRetention);
        // 2026-09-21 : le budget de temps est ce qu'il reste avant 53 s d'execution
        // totale (la fonction est limitee a 60 s), au lieu d'un forfait de 40 s qui
        // ignorait le temps deja pris par l'export et les autres courriels.
        const timeLeft = Math.max(5000, 53000 - (Date.now() - handlerStart));
        const r = await runProfileCampaign(members, { dryRun: false, limit: Math.min(budgetLeft, parseInt(process.env.CAMPAIGN_DAILY_LIMIT || '40', 10)), timeBudgetMs: timeLeft, log: console.log });
        console.log(`[campagne] cron : ${r.sent} envoyes, ${r.failed} echecs, deja ${r.sentToday} aujourd'hui, restants A=${r.remainingBefore.A} B=${r.remainingBefore.B}${r.stoppedByTime ? ', arret par budget de temps' : ''}`);
      } catch (campErr) {
        console.error('[campagne] erreur :', campErr.message, campErr.stack);
      }
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('Content-Disposition', 'inline; filename="public_members.csv"');
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Export error:', err.message, err.stack);
    return res.status(500).json({ error: 'Export failed', detail: err.message });
  }
};
