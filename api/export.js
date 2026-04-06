/**
 * GET /api/export
 * Exports all members from Notion → CSV format
 * Applies consent rules identical to prepare_public_csv.py
 *
 * Called by Vercel cron daily or on-demand
 */
const { getAllMembers, CSV_COL } = require('../lib/notion');

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

  const row = {
    [CSV_COL.prenom]: m.prenom,
    [CSV_COL.nom]: m.nom,
    [CSV_COL.email]: m.email,
    [CSV_COL.email2]: m.email2,
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

    // Build CSV
    const allRows = [...publicRows, ...pendingRows, statsRow];
    const lines = [HEADERS.map(escapeCSV).join(',')];
    for (const row of allRows) {
      lines.push(HEADERS.map(h => escapeCSV(row[h])).join(','));
    }
    const csv = lines.join('\n');

    // Return CSV with caching
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    res.setHeader('Content-Disposition', 'inline; filename="public_members.csv"');
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Export error:', err.message, err.stack);
    return res.status(500).json({ error: 'Export failed', detail: err.message });
  }
};
