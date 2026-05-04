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
 *   mode=fix-fields-dry-run  : retourne le plan de correction (avant/apres)
 *                               sans rien modifier dans Notion.
 *   mode=fix-fields-apply    : applique les corrections planifiees dans Notion.
 *                               Idempotent : rerunable sans effet de bord
 *                               (skip si la valeur est deja a jour).
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
const { getAllMembers, getValidatedInstitutions, PROP } = require('../lib/notion');
const { Client } = require('@notionhq/client');

let _notion;
function notion() {
  if (!_notion) _notion = new Client({ auth: process.env.NOTION_KEY });
  return _notion;
}

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

// ─── Field correction mappings (mode=fix-fields) ───
// Validated by Tess on 2026-05-04 from the field-audit report.
const STATUT_FALLBACK_AUTRES = STATUT_OPTIONS.find(s => s.startsWith('Autres statuts'));
const STATUT_FIXES = {
  'Chercheur ou chercheuse universitaire': 'Chercheur universitaire',
  'Etudiant·e au doctorat': 'Personne aux études au doctorat',
  'Étudiant·e à la maîtrise': 'Personne aux études à la maîtrise',
  'Professionnel·le de la recherche': 'Professionnel de recherche',
  'Étudiant·e au baccalauréat': 'Personne aux études au 1er cycle',
  'Gestionnaire ou cadre': 'Direction ou gestion',
  'Professionnel·le de la santé': 'Professionnel de la santé',
  'Chercheur universitaire clinicien ou chercheuse universitaire clinicienne': 'Chercheur clinicien universitaire',
  'Autres statuts de recherche': STATUT_FALLBACK_AUTRES,
  "Autres statuts de recherche (Chercheur ou chercheuse d’une institution gouvernementale, d'une organisation du secteur gouvernemental ou privé, personne des milieux de pratique, artiste ou contribuant individuel)": STATUT_FALLBACK_AUTRES,
  'Stagiaire postdoctoral·e': 'Stagiaire postdoctoral',
  'Chercheur ou chercheuse de collège': 'Chercheur de collège',
  'Étudiant·e à la maîtrise au doctorat': 'Personne aux études au doctorat',
  'Professeure adjointe': 'Chercheur universitaire',
  'Professeur': 'Chercheur universitaire',
  'Professeur adjoint de clinique': 'Chercheur universitaire',
  'Chercheur ou chercheuse': 'Chercheur universitaire',
  'Physician, Medical Geneticist at MUHC; Clinician Researcher, Faculty at McGill': 'Chercheur universitaire',
  'Radiologiste; Professeur titulaire': 'Chercheur universitaire',
  'Étudiant en médecine': 'Personne aux études au doctorat',
  'Étudiante au programme de 3è cycle AnÉSOSS': 'Personne aux études au doctorat',
  'Étudiante au doctorat, Département de médecine, Faculté de médecine, Université Laval': 'Personne aux études au doctorat',
  'Enseignant chercheur et à la fois doctorant': 'Personne aux études au doctorat',
  'Medical Student and Researcher': 'Personne aux études au doctorat',
  'Associé·e de recherche': 'Professionnel de recherche',
  'Biostatisticien': 'Professionnel de recherche',
  'Gestionnaire de projet en santé numerique': 'Direction ou gestion',
  'Professionnel de la santé + Master Student': 'Professionnel de la santé',
  "Professionnelle de la santé inscrite au DESS en gestion - analyse d'affaires - TI": 'Professionnel de la santé',
  'Research Associate': STATUT_FALLBACK_AUTRES,
  'Research staff (Open Science Program Coordinator)': STATUT_FALLBACK_AUTRES,
  'Resident Physician': STATUT_FALLBACK_AUTRES,
  'Postgraduate Resident': STATUT_FALLBACK_AUTRES,
  'Clinical Informatics Specialist': STATUT_FALLBACK_AUTRES,
  'patiente-partenaire': STATUT_FALLBACK_AUTRES,
  'Patiente partenaire': STATUT_FALLBACK_AUTRES,
  'Citoyen partenaire': STATUT_FALLBACK_AUTRES,
  'Bibliothécaire': STATUT_FALLBACK_AUTRES,
  'CNIO': STATUT_FALLBACK_AUTRES,
  'Présidente du Prix Hippocrate': STATUT_FALLBACK_AUTRES,
  'Coordonnatrice du Pôle': STATUT_FALLBACK_AUTRES,
  'Coordonnatrice académique numérique de la santé': STATUT_FALLBACK_AUTRES,
  'Affaires professorales': STATUT_FALLBACK_AUTRES,
  'Transcriptrice médical': STATUT_FALLBACK_AUTRES,
  "Analyste d'affaires systemes comptables": STATUT_FALLBACK_AUTRES,
  'gestion de projets scientifiques': STATUT_FALLBACK_AUTRES,
  'Member of the RSN gestion team :)': STATUT_FALLBACK_AUTRES,
  'Chef de programmes santé publique - Direction de Santé Publique': STATUT_FALLBACK_AUTRES,
  "Organisation à but non lucratif oeuvrant dans le champ d'intérêt du RSN": STATUT_FALLBACK_AUTRES,
  'reconnue par les FRQ ou privé': STATUT_FALLBACK_AUTRES,
};

const EVALUATEUR_FIXES = {
  'Incertain·e pour le moment': 'Incertain',
  'Incertain': 'Incertain',
};

function fixOrcid(value) {
  if (!value) return null;
  const m = /^https?:\/\/(\d{4}-\d{4}-\d{4}-\d{3}[\dxX])\/?$/.exec(value);
  if (m) return `https://orcid.org/${m[1]}`;
  return null;
}

function fixCv(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (v.toUpperCase() === 'CV') return '';
  if (/^(www\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(v)) return `https://${v}`;
  return null;
}

async function fixFieldsReport(dryRun) {
  const all = await getAllMembers();
  const planned = [];
  for (const m of all) {
    const empty = !m.prenom && !m.nom && !m.email;
    if (empty) continue;
    const sum = { id: m.id, prenom: m.prenom, nom: m.nom, email: m.email };
    if (m.statut && STATUT_FIXES[m.statut] !== undefined) {
      const after = STATUT_FIXES[m.statut];
      if (after !== m.statut) planned.push({ ...sum, field: 'statut', before: m.statut, after });
    }
    if (m.evaluateur && EVALUATEUR_FIXES[m.evaluateur] !== undefined) {
      const after = EVALUATEUR_FIXES[m.evaluateur];
      if (after !== m.evaluateur) planned.push({ ...sum, field: 'evaluateur', before: m.evaluateur, after });
    }
    if (m.orcid) {
      const fixed = fixOrcid(m.orcid);
      if (fixed && fixed !== m.orcid) planned.push({ ...sum, field: 'orcid', before: m.orcid, after: fixed });
    }
    if (m.cv) {
      const fixed = fixCv(m.cv);
      if (fixed !== null && fixed !== m.cv) planned.push({ ...sum, field: 'cv', before: m.cv, after: fixed });
    }
  }
  const counts = {};
  for (const f of planned) counts[f.field] = (counts[f.field] || 0) + 1;
  if (dryRun) return { mode: 'fix-fields-dry-run', total: planned.length, counts, planned };

  const byPage = new Map();
  for (const f of planned) {
    if (!byPage.has(f.id)) byPage.set(f.id, []);
    byPage.get(f.id).push(f);
  }
  const applied = [], failed = [];
  for (const [pageId, fixes] of byPage) {
    const props = {};
    for (const fx of fixes) {
      if (fx.field === 'statut') props[PROP.statut] = { rich_text: [{ text: { content: String(fx.after).slice(0, 2000) } }] };
      else if (fx.field === 'evaluateur') props[PROP.evaluateur] = { rich_text: [{ text: { content: String(fx.after).slice(0, 2000) } }] };
      else if (fx.field === 'orcid') props[PROP.orcid] = { url: fx.after || null };
      else if (fx.field === 'cv') props[PROP.cv] = { url: fx.after || null };
    }
    try {
      await notion().pages.update({ page_id: pageId, properties: props });
      applied.push({ pageId, fixes });
    } catch (err) {
      failed.push({ pageId, fixes, error: err.message });
    }
  }
  return { mode: 'fix-fields-apply', totalPlanned: planned.length, counts, appliedPages: applied.length, failedPages: failed.length, failed };
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

    if (mode === 'fix-fields-dry-run') {
      const report = await fixFieldsReport(true);
      return res.status(200).json({ ok: true, ...report });
    }

    if (mode === 'fix-fields-apply') {
      const report = await fixFieldsReport(false);
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
