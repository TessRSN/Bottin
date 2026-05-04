/**
 * GET /api/export
 * Exports all members from Notion → CSV format
 * Applies consent rules identical to prepare_public_csv.py
 *
 * Called by Vercel cron daily or on-demand
 */
const crypto = require('crypto');
const {
  getAllMembers, markAcceptanceEmailSent, setMemberCheckbox, archiveMemberPage,
  CSV_COL,
} = require('../lib/notion');
const {
  sendAcceptanceEmail,
  sendRenewalReminder60j, sendRenewalReminder30j,
  sendArchiveNotification, sendAdminRetentionRecap,
} = require('../lib/email');
const { signRenewalToken } = require('../lib/token');

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

async function runRetentionCron(allMembers) {
  const enabled = process.env.RETENTION_EMAILS_ENABLED === 'true';
  const dailyLimit = parseInt(process.env.RETENTION_EMAILS_DAILY_LIMIT || '30', 10);
  const testRecipientsEnv = (process.env.RETENTION_EMAILS_TEST_RECIPIENTS || '').trim();
  const testRecipients = testRecipientsEnv ? testRecipientsEnv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : null;
  const adminRecipients = (process.env.ADMIN_NOTIFICATION_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);
  const today = todayISO();
  const baseUrl = process.env.BASE_URL || 'https://bottin-gamma.vercel.app';

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
  const eligible = allMembers.filter(m =>
    m.email && m.email.includes('@') &&
    m.dateRenouvellement &&
    m.workflow !== 'Refusé'
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
  CSV_COL.expertise, CSV_COL.themes,
  CSV_COL.axe1, CSV_COL.axe2, CSV_COL.axe3, CSV_COL.axe4,
  CSV_COL.pf1, CSV_COL.pf2, CSV_COL.pf3, CSV_COL.pf4, CSV_COL.pf5,
  CSV_COL.ca1, CSV_COL.ca2, CSV_COL.ca3,
  CSV_COL.projet, CSV_COL.etudiants, CSV_COL.refere, CSV_COL.droitVote,
  CSV_COL.orcid, CSV_COL.cv, CSV_COL.evaluateur, CSV_COL.consent,
];

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
    [CSV_COL.expertise]: m.expertise,
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
  };

  return row;
}

function maskSensitive(row) {
  // Mask personal data but keep structural fields
  const sensitive = [
    CSV_COL.email, CSV_COL.email2, CSV_COL.statut, CSV_COL.institution,
    CSV_COL.reseau, CSV_COL.expertise, CSV_COL.themes, CSV_COL.projet,
    CSV_COL.etudiants, CSV_COL.refere, CSV_COL.orcid, CSV_COL.cv,
    CSV_COL.evaluateur,
  ];
  for (const col of sensitive) {
    row[col] = PLACEHOLDER[col] || '';
  }
  return row;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const members = await getAllMembers();

    const publicRows = [];
    const pendingRows = [];
    const excludedStats = { total: 0, regulier: 0, etudiant: 0, partenaire: 0 };

    for (const m of members) {
      // Skip empty entries
      if (!m.prenom && !m.nom) continue;

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
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      return res.status(304).end();
    }

    // Send acceptance emails to newly-approved members (idempotent via checkbox)
    // Triggered when admin moves a card to "Approuvé" in the Notion Kanban.
    // Failures don't block the CSV response — they'll be retried tomorrow.
    let emailsSent = 0;
    let emailsFailed = 0;
    for (const m of members) {
      if (m.workflow !== 'Approuvé') continue;
      if (m.emailAccepteEnvoye) continue;
      if (!m.email || !m.prenom) continue;
      try {
        await sendAcceptanceEmail(m.email, m.prenom);
        await markAcceptanceEmailSent(m.id);
        emailsSent++;
        console.log(`[export] Acceptance email sent to ${m.email}`);
      } catch (err) {
        emailsFailed++;
        console.error(`[export] Failed to send acceptance email to ${m.email}:`, err.message);
      }
    }
    if (emailsSent > 0 || emailsFailed > 0) {
      console.log(`[export] Acceptance emails: ${emailsSent} sent, ${emailsFailed} failed`);
    }

    // Run the membership retention cron (Phase 3, Loi 25).
    // Reuses the `members` list already fetched above. Wrapped in try/catch so
    // any failure here doesn't break the CSV response.
    try {
      await runRetentionCron(members);
    } catch (retErr) {
      console.error('[retention] Top-level error:', retErr.message, retErr.stack);
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
