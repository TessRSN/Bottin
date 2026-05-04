/**
 * Notion API client for RSN members database
 */
const { Client } = require('@notionhq/client');

// Lazy init — env vars available at function invocation time, not module load
let _notion;
function notion() {
  if (!_notion) _notion = new Client({ auth: process.env.NOTION_KEY });
  return _notion;
}

// ─── PROPERTY MAPPING ───
// Single source of truth for Notion ↔ CSV column names
const PROP = {
  prenom: 'Prénom',           // title
  nom: 'Nom',                 // rich_text
  email: 'Email',             // email
  email2: 'Email secondaire', // email
  institution: 'Institution', // rich_text
  statut: 'Statut',           // select (converti de rich_text le 2026-05-04)
  type: "Type d'adhésion",    // select
  reseau: 'Réseau',           // rich_text
  expertise: 'Expertise',     // rich_text
  themes: "Thèmes d'intérêt", // rich_text
  axes: "Axes d'intérêt",     // multi_select
  principes: 'Principes fondateurs', // multi_select
  champs: "Champs d'action",  // multi_select
  projet: 'Projet de recherche', // rich_text
  etudiants: 'Étudiants',     // rich_text
  refere: 'Référé par',       // rich_text
  droitVote: 'Droit de vote', // checkbox
  orcid: 'ORCID',             // url
  cv: 'CV / LinkedIn',        // url
  evaluateur: 'Évaluateur',   // select (converti de rich_text le 2026-05-04)
  consent: 'Consentement',    // select
  afficherCourriel: 'Afficher courriel', // checkbox (Phase 2f, 2026-05-04)
  workflow: 'Statut workflow', // select
  emailAccepteEnvoye: "Email d'acceptation envoyé", // checkbox
  dateDebut: "Date de début d'adhésion",   // date
  dateRenouvellement: "Date de renouvellement", // date
  emailRenouv60jEnvoye: 'Email renouv. 60j envoyé', // checkbox
  emailRenouv30jEnvoye: 'Email renouv. 30j envoyé', // checkbox
  emailArchivageEnvoye: 'Email archivage envoyé',   // checkbox
  institutionLiee: 'Institution liée',              // relation -> Institutions DB
};

// CSV column names (must match index.html CONFIG.COL exactly)
const CSV_COL = {
  prenom: 'Prénom',
  nom: 'Nom de la famille',
  email: 'E-mail / Courriel',
  email2: 'Autre courriel',
  statut: 'Statut actuel',
  institution: 'Institution / organisation 1',
  type: "Type d'adhesion",
  reseau: 'Réseau 1',
  expertise: 'Expertise',
  themes: "Thèmes d'intérêt",
  axe1: "1e Axe d'intérêt", axe2: "2e Axe d'intérêt",
  axe3: "3e Axe d'intérêt", axe4: "4e Axe d'intérêt",
  pf1: "1è Principles fondateurs", pf2: "2è Principles fondateurs",
  pf3: "3è Principles fondateurs", pf4: "4è Principles fondateurs",
  pf5: "5è Principles fondateurs",
  ca1: "1è Champs d'action", ca2: "2è Champs d'action", ca3: "3è Champs d'action",
  projet: 'Projet de recherche',
  etudiants: 'Étudiant.e.s',
  refere: 'Référée par',
  droitVote: 'Droit de vote',
  orcid: 'ORCID',
  cv: 'CV / LinkedIn',
  evaluateur: 'Évaluateur du RSN - nouv. formulaire',
  consent: 'Autorisez-vous le RSN à vous créer un profil de membre public',
};

// ─── HELPERS ───
function getText(prop) {
  if (!prop) return '';
  if (prop.title) return prop.title.map(t => t.plain_text).join('');
  if (prop.rich_text) return prop.rich_text.map(t => t.plain_text).join('');
  if (prop.email) return prop.email || '';
  if (prop.url) return prop.url || '';
  if (prop.select) return prop.select?.name || '';
  if (prop.multi_select) return prop.multi_select.map(s => s.name);
  if (prop.checkbox !== undefined) return prop.checkbox;
  return '';
}

function richText(value) {
  if (!value) return [];
  return [{ text: { content: String(value).slice(0, 2000) } }];
}

// ─── QUERIES ───

/**
 * Find a member by email (primary or secondary)
 * Returns the Notion page or null
 */
async function findByEmail(email) {
  const normalized = email.toLowerCase().trim();

  // Search primary email
  const resp = await notion().databases.query({
    database_id: process.env.NOTION_DB_ID,
    filter: {
      property: PROP.email,
      email: { equals: normalized },
    },
    page_size: 1,
  });
  if (resp.results.length) return resp.results[0];

  // Search secondary email
  const resp2 = await notion().databases.query({
    database_id: process.env.NOTION_DB_ID,
    filter: {
      property: PROP.email2,
      email: { equals: normalized },
    },
    page_size: 1,
  });
  return resp2.results[0] || null;
}

/**
 * Get a member profile by page ID
 * Returns a flat object with all fields
 */
async function getProfile(pageId) {
  const page = await notion().pages.retrieve({ page_id: pageId });
  const p = page.properties;
  return {
    id: page.id,
    prenom: getText(p[PROP.prenom]),
    nom: getText(p[PROP.nom]),
    email: getText(p[PROP.email]),
    email2: getText(p[PROP.email2]),
    institution: getText(p[PROP.institution]),
    statut: getText(p[PROP.statut]),
    type: getText(p[PROP.type]),
    reseau: getText(p[PROP.reseau]),
    expertise: getText(p[PROP.expertise]),
    themes: getText(p[PROP.themes]),
    axes: getText(p[PROP.axes]),         // array
    principes: getText(p[PROP.principes]), // array
    champs: getText(p[PROP.champs]),       // array
    projet: getText(p[PROP.projet]),
    etudiants: getText(p[PROP.etudiants]),
    refere: getText(p[PROP.refere]),
    droitVote: getText(p[PROP.droitVote]),
    orcid: getText(p[PROP.orcid]),
    cv: getText(p[PROP.cv]),
    evaluateur: getText(p[PROP.evaluateur]),
    consent: getText(p[PROP.consent]),
    workflow: getText(p[PROP.workflow]),
    // Phase 2f: '!== false' pour retro-compatibilite (default visible si
    // la propriete n'a pas encore ete creee/remplie dans Notion).
    afficherCourriel: getText(p[PROP.afficherCourriel]) !== false,
  };
}

/**
 * Update a member's profile (partial update)
 * Only updates fields present in `data`
 */
async function updateProfile(pageId, data) {
  const properties = {};

  if (data.prenom !== undefined) properties[PROP.prenom] = { title: richText(data.prenom) };
  if (data.nom !== undefined) properties[PROP.nom] = { rich_text: richText(data.nom) };
  if (data.institution !== undefined) properties[PROP.institution] = { rich_text: richText(data.institution) };
  // Phase 1 (2026-05-04): statut converti de rich_text -> select dans Notion
  if (data.statut !== undefined) properties[PROP.statut] = { select: data.statut ? { name: data.statut } : null };
  if (data.reseau !== undefined) properties[PROP.reseau] = { rich_text: richText(data.reseau) };
  if (data.expertise !== undefined) properties[PROP.expertise] = { rich_text: richText(data.expertise) };
  if (data.themes !== undefined) properties[PROP.themes] = { rich_text: richText(data.themes) };
  if (data.projet !== undefined) properties[PROP.projet] = { rich_text: richText(data.projet) };
  if (data.etudiants !== undefined) properties[PROP.etudiants] = { rich_text: richText(data.etudiants) };

  if (data.email !== undefined) properties[PROP.email] = { email: data.email || null };
  if (data.email2 !== undefined) properties[PROP.email2] = { email: data.email2 || null };

  if (data.type !== undefined) properties[PROP.type] = { select: data.type ? { name: data.type } : null };

  // Phase 2e (2026-05-04): droit de vote = type 'Régulier' (regle metier).
  // L'admin peut toujours forcer manuellement la valeur via Notion ; sinon
  // la regle est appliquee automatiquement a chaque update qui touche le type.
  if (data.droitVote !== undefined) properties[PROP.droitVote] = { checkbox: !!data.droitVote };

  // Phase 2f (2026-05-04): toggle 'Afficher courriel' dans le bottin public.
  if (data.afficherCourriel !== undefined) properties[PROP.afficherCourriel] = { checkbox: !!data.afficherCourriel };

  if (data.axes !== undefined) properties[PROP.axes] = { multi_select: (data.axes || []).map(n => ({ name: n })) };
  if (data.principes !== undefined) properties[PROP.principes] = { multi_select: (data.principes || []).map(n => ({ name: n })) };
  if (data.champs !== undefined) properties[PROP.champs] = { multi_select: (data.champs || []).map(n => ({ name: n })) };

  if (data.orcid !== undefined) properties[PROP.orcid] = { url: data.orcid || null };
  if (data.cv !== undefined) properties[PROP.cv] = { url: data.cv || null };

  if (data.consent !== undefined) properties[PROP.consent] = { select: data.consent ? { name: data.consent } : null };

  // Always mark as "Modifié" when member updates
  properties[PROP.workflow] = { select: { name: 'Modifié' } };

  await notion().pages.update({ page_id: pageId, properties });
}

/**
 * Get all members (for CSV export)
 * Returns array of flat profile objects
 */
async function getAllMembers() {
  const members = [];
  let cursor;

  do {
    const params = { database_id: process.env.NOTION_DB_ID, page_size: 100 };
    if (cursor) params.start_cursor = cursor;

    const resp = await notion().databases.query(params);
    for (const page of resp.results) {
      if (page.archived) continue;
      const p = page.properties;
      members.push({
        id: page.id,
        prenom: getText(p[PROP.prenom]),
        nom: getText(p[PROP.nom]),
        email: getText(p[PROP.email]),
        email2: getText(p[PROP.email2]),
        institution: getText(p[PROP.institution]),
        statut: getText(p[PROP.statut]),
        type: getText(p[PROP.type]),
        reseau: getText(p[PROP.reseau]),
        expertise: getText(p[PROP.expertise]),
        themes: getText(p[PROP.themes]),
        axes: getText(p[PROP.axes]) || [],
        principes: getText(p[PROP.principes]) || [],
        champs: getText(p[PROP.champs]) || [],
        projet: getText(p[PROP.projet]),
        etudiants: getText(p[PROP.etudiants]),
        refere: getText(p[PROP.refere]),
        droitVote: getText(p[PROP.droitVote]),
        orcid: getText(p[PROP.orcid]),
        cv: getText(p[PROP.cv]),
        evaluateur: getText(p[PROP.evaluateur]),
        consent: getText(p[PROP.consent]),
        workflow: getText(p[PROP.workflow]),
        emailAccepteEnvoye: getText(p[PROP.emailAccepteEnvoye]) === true,
        dateDebut: (p[PROP.dateDebut] && p[PROP.dateDebut].date && p[PROP.dateDebut].date.start) || null,
        dateRenouvellement: (p[PROP.dateRenouvellement] && p[PROP.dateRenouvellement].date && p[PROP.dateRenouvellement].date.start) || null,
        emailRenouv60jEnvoye: getText(p[PROP.emailRenouv60jEnvoye]) === true,
        emailRenouv30jEnvoye: getText(p[PROP.emailRenouv30jEnvoye]) === true,
        emailArchivageEnvoye: getText(p[PROP.emailArchivageEnvoye]) === true,
        afficherCourriel: getText(p[PROP.afficherCourriel]) !== false,
        institutionIds: (p[PROP.institutionLiee] && p[PROP.institutionLiee].relation || []).map(r => r.id),
      });
    }
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return members;
}

/**
 * Create a new member in Notion
 * Sets workflow status to "Nouveau"
 */
async function createMember(data) {
  const properties = {};

  properties[PROP.prenom] = { title: richText(data.prenom) };
  properties[PROP.nom] = { rich_text: richText(data.nom) };
  if (data.email) properties[PROP.email] = { email: data.email };
  if (data.email2) properties[PROP.email2] = { email: data.email2 };
  if (data.institution) properties[PROP.institution] = { rich_text: richText(data.institution) };
  // Phase 1 (2026-05-04): statut converti de rich_text -> select dans Notion
  if (data.statut) properties[PROP.statut] = { select: { name: data.statut } };
  if (data.type) properties[PROP.type] = { select: { name: data.type } };
  // Phase 2e: droit de vote auto = type Régulier
  if (data.droitVote !== undefined) properties[PROP.droitVote] = { checkbox: !!data.droitVote };
  // Phase 2f: toggle 'Afficher courriel' (default true a la creation via join.html)
  if (data.afficherCourriel !== undefined) properties[PROP.afficherCourriel] = { checkbox: !!data.afficherCourriel };
  if (data.reseau) properties[PROP.reseau] = { rich_text: richText(data.reseau) };
  if (data.expertise) properties[PROP.expertise] = { rich_text: richText(data.expertise) };
  if (data.themes) properties[PROP.themes] = { rich_text: richText(data.themes) };
  if (data.projet) properties[PROP.projet] = { rich_text: richText(data.projet) };
  if (data.etudiants) properties[PROP.etudiants] = { rich_text: richText(data.etudiants) };
  if (data.refere) properties[PROP.refere] = { rich_text: richText(data.refere) };
  if (data.orcid) properties[PROP.orcid] = { url: data.orcid };
  if (data.cv) properties[PROP.cv] = { url: data.cv };

  if (data.axes && data.axes.length) properties[PROP.axes] = { multi_select: data.axes.map(function(n) { return { name: n }; }) };
  if (data.principes && data.principes.length) properties[PROP.principes] = { multi_select: data.principes.map(function(n) { return { name: n }; }) };
  if (data.champs && data.champs.length) properties[PROP.champs] = { multi_select: data.champs.map(function(n) { return { name: n }; }) };

  if (data.consent) properties[PROP.consent] = { select: { name: data.consent } };

  // Membership dates (used during the recreation of historical members)
  if (data.dateDebut) properties[PROP.dateDebut] = { date: { start: data.dateDebut } };
  if (data.dateRenouvellement) properties[PROP.dateRenouvellement] = { date: { start: data.dateRenouvellement } };

  // For historical/recreated members, mark email already sent to prevent
  // the daily cron from sending an "your profile is approved!" notification.
  if (data.emailAccepteEnvoye) properties[PROP.emailAccepteEnvoye] = { checkbox: true };

  // Always set as "Nouveau" for new members (admin will review and approve)
  properties[PROP.workflow] = { select: { name: 'Nouveau' } };

  const created = await notion().pages.create({
    parent: { database_id: process.env.NOTION_DB_ID },
    properties: properties,
  });
  return created; // includes .id for the caller
}

/**
 * Mark a member's "Email d'acceptation envoyé" checkbox as true.
 * Used after sending the acceptance email to ensure idempotence.
 */
async function markAcceptanceEmailSent(pageId) {
  await notion().pages.update({
    page_id: pageId,
    properties: {
      [PROP.emailAccepteEnvoye]: { checkbox: true },
    },
  });
}

/**
 * Set the membership dates (start + renewal) on a member's page.
 * Both dates expected in ISO format YYYY-MM-DD.
 */
async function setMembershipDates(pageId, dateDebut, dateRenouvellement) {
  const properties = {};
  if (dateDebut) properties[PROP.dateDebut] = { date: { start: dateDebut } };
  if (dateRenouvellement) properties[PROP.dateRenouvellement] = { date: { start: dateRenouvellement } };
  await notion().pages.update({ page_id: pageId, properties });
}

/**
 * Mark an arbitrary checkbox property on a member's page.
 * Used by the retention cron to flag fiches once a renewal email
 * (60j / 30j / archivage) has been sent, so the same email isn't
 * re-sent the next day.
 */
async function setMemberCheckbox(pageId, propKey, value) {
  await notion().pages.update({
    page_id: pageId,
    properties: { [PROP[propKey]]: { checkbox: !!value } },
  });
}

/**
 * Renew a member's adhesion: bump dateDebut to today, dateRenouvellement
 * to today + 2 years, and reset the three email-sent checkboxes so the
 * cycle starts over.
 */
async function renewMembership(pageId, todayISO) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayISO);
  if (!parts) throw new Error('Invalid todayISO format: ' + todayISO);
  const newRenouv = `${parseInt(parts[1], 10) + 2}-${parts[2]}-${parts[3]}`;

  await notion().pages.update({
    page_id: pageId,
    properties: {
      [PROP.dateDebut]: { date: { start: todayISO } },
      [PROP.dateRenouvellement]: { date: { start: newRenouv } },
      [PROP.emailRenouv60jEnvoye]: { checkbox: false },
      [PROP.emailRenouv30jEnvoye]: { checkbox: false },
      [PROP.emailArchivageEnvoye]: { checkbox: false },
    },
  });
  return { dateDebut: todayISO, dateRenouvellement: newRenouv };
}

/**
 * Soft-delete (archive) a member's page in Notion. Keeps the data in
 * Notion's trash for 30 days then it's permanently deleted.
 */
async function archiveMemberPage(pageId) {
  await notion().pages.update({ page_id: pageId, archived: true });
}

/**
 * Set the "Institution liée" Relation on a member's page.
 * institutionPageIds: array of Notion page IDs (from Institutions DB).
 * Pass [] to clear the relation.
 */
async function setMemberInstitutionRelation(pageId, institutionPageIds) {
  await notion().pages.update({
    page_id: pageId,
    properties: {
      [PROP.institutionLiee]: { relation: (institutionPageIds || []).map(id => ({ id })) },
    },
  });
}

// ─── INSTITUTIONS DATABASE ───
// A second Notion database tracking the canonical list of institutions
// with their geographic coordinates. Used by both the directory map
// (GET /api/institutions) and the join form autocomplete.
//
// Statuts:
//   "Validée"   → visible everywhere (map + autocomplete)
//   "En attente"→ submitted by a member, awaiting admin review
//   "Refusée"   → admin rejected (e.g. duplicate, typo)

const INST_PROP = {
  nom: 'Nom',          // title
  adresse: 'Adresse',  // rich_text
  latitude: 'Latitude',  // number
  longitude: 'Longitude', // number
  statut: 'Statut',    // select
};

function getNumber(prop) {
  if (!prop) return null;
  return typeof prop.number === 'number' ? prop.number : null;
}

/**
 * Get all institutions with status "Validée".
 * Returns an array of { name, lat, lng } objects.
 */
async function getValidatedInstitutions() {
  const dbId = process.env.NOTION_INSTITUTIONS_DB_ID;
  if (!dbId) throw new Error('NOTION_INSTITUTIONS_DB_ID not configured');

  const institutions = [];
  let cursor;

  do {
    const params = {
      database_id: dbId,
      page_size: 100,
      filter: {
        property: INST_PROP.statut,
        select: { equals: 'Validée' },
      },
    };
    if (cursor) params.start_cursor = cursor;

    const resp = await notion().databases.query(params);
    for (const page of resp.results) {
      if (page.archived) continue;
      const p = page.properties;
      const name = getText(p[INST_PROP.nom]);
      const lat = getNumber(p[INST_PROP.latitude]);
      const lng = getNumber(p[INST_PROP.longitude]);
      if (name && lat !== null && lng !== null) {
        institutions.push({ name, lat, lng });
      }
    }
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return institutions;
}

/**
 * Get ALL institutions (any status) — used for admin scripts that need
 * to inspect the full catalog including "En attente" and "Refusée".
 */
async function getAllInstitutions() {
  const dbId = process.env.NOTION_INSTITUTIONS_DB_ID;
  if (!dbId) throw new Error('NOTION_INSTITUTIONS_DB_ID not configured');

  const institutions = [];
  let cursor;

  do {
    const params = { database_id: dbId, page_size: 100 };
    if (cursor) params.start_cursor = cursor;
    const resp = await notion().databases.query(params);
    for (const page of resp.results) {
      if (page.archived) continue;
      const p = page.properties;
      institutions.push({
        id: page.id,
        name: getText(p[INST_PROP.nom]),
        adresse: getText(p[INST_PROP.adresse]),
        latitude: getNumber(p[INST_PROP.latitude]),
        longitude: getNumber(p[INST_PROP.longitude]),
        statut: getText(p[INST_PROP.statut]),
      });
    }
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return institutions;
}

/**
 * Find an institution by exact name (any status). Used to avoid duplicates
 * during the one-shot import and when members submit new ones.
 */
async function findInstitutionByName(name) {
  const dbId = process.env.NOTION_INSTITUTIONS_DB_ID;
  if (!dbId) throw new Error('NOTION_INSTITUTIONS_DB_ID not configured');

  const resp = await notion().databases.query({
    database_id: dbId,
    page_size: 1,
    filter: {
      property: INST_PROP.nom,
      title: { equals: name },
    },
  });
  return resp.results[0] || null;
}

/**
 * Update an existing institution entry in Notion (partial update).
 * Only the fields present in `data` are written.
 */
async function updateInstitution(pageId, data) {
  const properties = {};
  if (data.name !== undefined) properties[INST_PROP.nom] = { title: richText(data.name) };
  if (data.address !== undefined) properties[INST_PROP.adresse] = { rich_text: richText(data.address) };
  if (typeof data.latitude === 'number') properties[INST_PROP.latitude] = { number: data.latitude };
  if (typeof data.longitude === 'number') properties[INST_PROP.longitude] = { number: data.longitude };
  if (data.statut) properties[INST_PROP.statut] = { select: { name: data.statut } };
  await notion().pages.update({ page_id: pageId, properties });
}

/**
 * Create a new institution entry in Notion.
 * Used by both the import script (statut = "Validée") and the join form
 * (statut = "En attente").
 */
async function createInstitution({ name, address, latitude, longitude, statut }) {
  const dbId = process.env.NOTION_INSTITUTIONS_DB_ID;
  if (!dbId) throw new Error('NOTION_INSTITUTIONS_DB_ID not configured');

  const properties = {
    [INST_PROP.nom]: { title: richText(name) },
    [INST_PROP.statut]: { select: { name: statut || 'En attente' } },
  };
  if (address) properties[INST_PROP.adresse] = { rich_text: richText(address) };
  if (typeof latitude === 'number') properties[INST_PROP.latitude] = { number: latitude };
  if (typeof longitude === 'number') properties[INST_PROP.longitude] = { number: longitude };

  await notion().pages.create({
    parent: { database_id: dbId },
    properties,
  });
}

module.exports = {
  PROP, CSV_COL, INST_PROP,
  findByEmail, getProfile, updateProfile, getAllMembers, createMember,
  markAcceptanceEmailSent, setMembershipDates, setMemberCheckbox,
  renewMembership, archiveMemberPage, setMemberInstitutionRelation,
  getValidatedInstitutions, getAllInstitutions, findInstitutionByName, createInstitution, updateInstitution,
};
