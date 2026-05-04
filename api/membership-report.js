/**
 * GET /api/membership-report?key=YOUR_BACKUP_SECRET[&mode=...]
 *
 * Modes:
 *   (default)              : rapport qualite des fiches Membres
 *   mode=institution-mismatch : compare les institutions chez les
 *                               membres avec le catalogue Institutions
 *                               (Validee). Liste les ecarts + suggestions
 *                               de fuzzy match.
 *   mode=field-audit         : audit exhaustif des champs a valeurs
 *                               contraintes (statut, type, axes,
 *                               principes, champs, consent, evaluateur)
 *                               + verif formats (email, orcid, cv).
 *                               Sert de base a la Phase 1 du nettoyage
 *                               avant la refonte de edit.html.
 *   mode=full-data           : retourne les champs essentiels de tous les
 *                               membres pour cross-check local (CSV).
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

// ─── Reference values (must stay in sync with join.html) ───
const STATUT_OPTIONS = [
  'Chercheur universitaire',
  'Chercheur clinicien universitaire',
  'Chercheur de collège',
  'Autres statuts de recherche (institution gouvernementale, secteur privé, praticien, artiste, contributeur individuel)',
  'Professionnel de recherche',
  'Personne aux études au 1er cycle',
  'Personne aux études à la maîtrise',
  'Personne aux études au doctorat',
  'Stagiaire postdoctoral',
  'Direction ou gestion',
  "Membre de l'industrie",
  'Professionnel de la santé',
  'Autre',
];
const TYPE_OPTIONS = ['Régulier', 'Étudiant', 'Partenaire'];
const AXES_OPTIONS = [
  'Axe 1 - Plateformes numériques et gouvernance informationnelle',
  'Axe 2 - Modélisation et méthodes numériques',
  'Axe 3 - Intervention numérique',
  'Axe 4 - Transformation numérique',
];
const PRINCIPES_OPTIONS = [
  'Science ouverte',
  'Numérique de confiance',
  'Santé durable',
  'Engagement citoyen',
  'Équité diversité inclusion et accessibilité',
];
const CHAMPS_OPTIONS = [
  'Formation interdisciplinaire',
  'Mobilisation des connaissances',
  'Renforcement des capacités',
];
const CONSENT_OPTIONS = ['Oui', 'Non', ''];
const EVALUATEUR_OPTIONS = ['Oui', 'Non', ''];

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

// ─── Format validators ───
function isValidEmail(s) {
  if (!s) return true; // empty is OK (handled separately as "noEmail")
  const trimmed = String(s).trim();
  if (trimmed !== s) return false;        // leading/trailing whitespace
  if (/\s/.test(trimmed)) return false;   // any whitespace inside
  if (!trimmed.includes('@')) return false;
  if (trimmed.indexOf('@') !== trimmed.lastIndexOf('@')) return false;
  return true;
}
function isValidOrcid(s) {
  if (!s) return true; // empty is OK
  const trimmed = String(s).trim();
  // Accept either full URL (https://orcid.org/XXXX-XXXX-XXXX-XXXX) or bare id (XXXX-XXXX-XXXX-XXXX)
  if (/^https?:\/\/orcid\.org\/\d{4}-\d{4}-\d{4}-\d{3}[\dxX]$/.test(trimmed)) return true;
  if (/^\d{4}-\d{4}-\d{4}-\d{3}[\dxX]$/.test(trimmed)) return true;
  return false;
}
function isValidUrl(s) {
  if (!s) return true; // empty is OK
  const trimmed = String(s).trim();
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// ─── Field audit (mode=field-audit) ───
async function fieldAuditReport() {
  const all = await getAllMembers();
  const summary = (m) => ({ id: m.id, prenom: m.prenom, nom: m.nom, email: m.email });

  // Group anomalies by problematic value -> list of members
  function groupByValue(items) {
    const map = new Map();
    for (const it of items) {
      const key = it.value;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it.member);
    }
    return Array.from(map.entries())
      .map(([value, members]) => ({ value, count: members.length, members }))
      .sort((a, b) => b.count - a.count);
  }

  // Collect raw anomalies
  const statutBad = [];
  const typeBad = [];
  const axesBad = [];
  const principesBad = [];
  const champsBad = [];
  const consentBad = [];
  const evaluateurBad = [];
  const emailBad = [];
  const email2Bad = [];
  const orcidBad = [];
  const cvBad = [];

  for (const m of all) {
    const isEmpty = !m.prenom && !m.nom && !m.email;
    if (isEmpty) continue;

    // statut: rich_text, must be in STATUT_OPTIONS (or empty)
    if (m.statut && STATUT_OPTIONS.indexOf(m.statut) === -1) {
      statutBad.push({ value: m.statut, member: summary(m) });
    }

    // type: select, must be in TYPE_OPTIONS (or empty)
    if (m.type && TYPE_OPTIONS.indexOf(m.type) === -1) {
      typeBad.push({ value: m.type, member: summary(m) });
    }

    // axes / principes / champs are arrays of multi_select values
    for (const a of (m.axes || [])) {
      if (AXES_OPTIONS.indexOf(a) === -1) axesBad.push({ value: a, member: summary(m) });
    }
    for (const a of (m.principes || [])) {
      if (PRINCIPES_OPTIONS.indexOf(a) === -1) principesBad.push({ value: a, member: summary(m) });
    }
    for (const a of (m.champs || [])) {
      if (CHAMPS_OPTIONS.indexOf(a) === -1) champsBad.push({ value: a, member: summary(m) });
    }

    // consent: select, must be in CONSENT_OPTIONS
    if (m.consent && CONSENT_OPTIONS.indexOf(m.consent) === -1) {
      consentBad.push({ value: m.consent, member: summary(m) });
    }

    // evaluateur: rich_text, must be in EVALUATEUR_OPTIONS
    if (m.evaluateur && EVALUATEUR_OPTIONS.indexOf(m.evaluateur) === -1) {
      evaluateurBad.push({ value: m.evaluateur, member: summary(m) });
    }

    // email format
    if (m.email && !isValidEmail(m.email)) {
      emailBad.push({ value: m.email, member: summary(m) });
    }
    if (m.email2 && !isValidEmail(m.email2)) {
      email2Bad.push({ value: m.email2, member: summary(m) });
    }

    // orcid format
    if (m.orcid && !isValidOrcid(m.orcid)) {
      orcidBad.push({ value: m.orcid, member: summary(m) });
    }

    // cv format
    if (m.cv && !isValidUrl(m.cv)) {
      cvBad.push({ value: m.cv, member: summary(m) });
    }
  }

  return {
    mode: 'field-audit',
    totalMembers: all.length,
    counts: {
      statut: statutBad.length,
      type: typeBad.length,
      axes: axesBad.length,
      principes: principesBad.length,
      champs: champsBad.length,
      consent: consentBad.length,
      evaluateur: evaluateurBad.length,
      email: emailBad.length,
      email2: email2Bad.length,
      orcid: orcidBad.length,
      cv: cvBad.length,
    },
    anomalies: {
      statut: groupByValue(statutBad),
      type: groupByValue(typeBad),
      axes: groupByValue(axesBad),
      principes: groupByValue(principesBad),
      champs: groupByValue(champsBad),
      consent: groupByValue(consentBad),
      evaluateur: groupByValue(evaluateurBad),
      email: groupByValue(emailBad),
      email2: groupByValue(email2Bad),
      orcid: groupByValue(orcidBad),
      cv: groupByValue(cvBad),
    },
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

    if (mode === 'field-audit') {
      const report = await fieldAuditReport();
      return res.status(200).json({ ok: true, ...report });
    }

    if (mode === 'full-data') {
      // Returns essential fields for cross-checking with the CSV.
      // Used by scripts/compare-csv-notion.js (local).
      const all = await getAllMembers();
      const slim = all.map(m => ({
        id: m.id,
        prenom: m.prenom,
        nom: m.nom,
        email: (m.email || '').toLowerCase().trim(),
        email2: (m.email2 || '').toLowerCase().trim() || null,
        institution: m.institution,
        statut: m.statut,
        type: m.type,
        reseau: m.reseau,
        themes: m.themes,
        consent: m.consent,
        workflow: m.workflow,
        dateDebut: m.dateDebut,
        dateRenouvellement: m.dateRenouvellement,
        orcid: m.orcid,
        cv: m.cv,
      }));
      return res.status(200).json({ ok: true, count: slim.length, members: slim });
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
