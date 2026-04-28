/**
 * GET /api/membership-report?key=YOUR_BACKUP_SECRET[&mode=...]
 *
 * Modes:
 *   (default)              : rapport qualite des fiches Membres
 *   mode=institution-mismatch : compare les institutions chez les
 *                               membres avec le catalogue Institutions
 *                               (Validee). Liste les ecarts + suggestions
 *                               de fuzzy match.
 *
 * Issues detectees (mode default):
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
const { getAllMembers, getValidatedInstitutions } = require('../lib/notion');

function expectedRenewal(dateDebutISO) {
  if (!dateDebutISO) return null;
  const m = (dateDebutISO || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${parseInt(m[1], 10) + 2}-${m[2]}-${m[3]}`;
}

// ─── Fuzzy matching for institution names ───
function normalizeStr(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function similarityScore(a, b) {
  const aN = normalizeStr(a);
  const bN = normalizeStr(b);
  if (!aN || !bN) return 0;
  if (aN === bN) return 1.0;
  // Containment (one is a substring of the other)
  if (aN.includes(bN) || bN.includes(aN)) return 0.9;
  // Jaccard similarity on words longer than 2 chars
  const wordsA = new Set(aN.split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(bN.split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function bestMatch(needle, catalog) {
  let best = null;
  let score = 0;
  for (const item of catalog) {
    const s = similarityScore(needle, item);
    if (s > score) { score = s; best = item; }
  }
  return { match: best, score: Math.round(score * 100) / 100 };
}

async function institutionMismatchReport() {
  const [members, catalog] = await Promise.all([getAllMembers(), getValidatedInstitutions()]);
  const catalogNames = catalog.map(c => c.name);
  const catalogSet = new Set(catalogNames);

  // Map of institution name -> { members: [...], count }
  const usage = new Map();
  for (const m of members) {
    if (!m.institution) continue;
    const parts = m.institution.split(';').map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      if (!usage.has(p)) usage.set(p, []);
      usage.get(p).push({ id: m.id, name: `${m.prenom || ''} ${m.nom || ''}`.trim(), email: m.email });
    }
  }

  const matched = [];
  const unmatched = [];
  for (const [inst, mems] of usage) {
    if (catalogSet.has(inst)) {
      matched.push({ name: inst, count: mems.length });
    } else {
      const best = bestMatch(inst, catalogNames);
      unmatched.push({
        name: inst,
        count: mems.length,
        members: mems,
        suggestion: best.match,
        suggestionScore: best.score,
      });
    }
  }

  // Sort unmatched: highest impact first (most members), then alphabetical
  unmatched.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'));
  matched.sort((a, b) => b.count - a.count);

  // Catalog entries that aren't used by any member (potential cleanup candidates)
  const usedNames = new Set();
  for (const inst of usage.keys()) {
    if (catalogSet.has(inst)) usedNames.add(inst);
  }
  const unused = catalogNames.filter(n => !usedNames.has(n)).sort((a, b) => a.localeCompare(b, 'fr'));

  return {
    mode: 'institution-mismatch',
    totalUniqueInstitutionsUsed: usage.size,
    catalogSize: catalogNames.length,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    unusedCatalogCount: unused.length,
    unmatched,
    unused,
    matched,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const mode = (req.query && req.query.mode) || 'default';

  try {
    if (mode === 'institution-mismatch') {
      const report = await institutionMismatchReport();
      return res.status(200).json({ ok: true, ...report });
    }

    // Default: quality report
    const all = await getAllMembers();

    const summary = (m) => ({ id: m.id, prenom: m.prenom, nom: m.nom, email: m.email });

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
