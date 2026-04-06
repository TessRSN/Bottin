/**
 * Notion API client for RSN members database
 */
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_KEY });
const DB_ID = process.env.NOTION_DB_ID;

// ─── PROPERTY MAPPING ───
// Single source of truth for Notion ↔ CSV column names
const PROP = {
  prenom: 'Prénom',           // title
  nom: 'Nom',                 // rich_text
  email: 'Email',             // email
  email2: 'Email secondaire', // email
  institution: 'Institution', // rich_text
  statut: 'Statut',           // rich_text
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
  evaluateur: 'Évaluateur',   // rich_text
  consent: 'Consentement',    // select
  workflow: 'Statut workflow', // select
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
  const resp = await notion.databases.query({
    database_id: DB_ID,
    filter: {
      property: PROP.email,
      email: { equals: normalized },
    },
    page_size: 1,
  });
  if (resp.results.length) return resp.results[0];

  // Search secondary email
  const resp2 = await notion.databases.query({
    database_id: DB_ID,
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
  const page = await notion.pages.retrieve({ page_id: pageId });
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
  if (data.statut !== undefined) properties[PROP.statut] = { rich_text: richText(data.statut) };
  if (data.reseau !== undefined) properties[PROP.reseau] = { rich_text: richText(data.reseau) };
  if (data.expertise !== undefined) properties[PROP.expertise] = { rich_text: richText(data.expertise) };
  if (data.themes !== undefined) properties[PROP.themes] = { rich_text: richText(data.themes) };
  if (data.projet !== undefined) properties[PROP.projet] = { rich_text: richText(data.projet) };
  if (data.etudiants !== undefined) properties[PROP.etudiants] = { rich_text: richText(data.etudiants) };

  if (data.email !== undefined) properties[PROP.email] = { email: data.email || null };
  if (data.email2 !== undefined) properties[PROP.email2] = { email: data.email2 || null };

  if (data.type !== undefined) properties[PROP.type] = { select: data.type ? { name: data.type } : null };

  if (data.axes !== undefined) properties[PROP.axes] = { multi_select: (data.axes || []).map(n => ({ name: n })) };
  if (data.principes !== undefined) properties[PROP.principes] = { multi_select: (data.principes || []).map(n => ({ name: n })) };
  if (data.champs !== undefined) properties[PROP.champs] = { multi_select: (data.champs || []).map(n => ({ name: n })) };

  if (data.orcid !== undefined) properties[PROP.orcid] = { url: data.orcid || null };
  if (data.cv !== undefined) properties[PROP.cv] = { url: data.cv || null };

  if (data.consent !== undefined) properties[PROP.consent] = { select: data.consent ? { name: data.consent } : null };

  // Always mark as "Modifié" when member updates
  properties[PROP.workflow] = { select: { name: 'Modifié' } };

  await notion.pages.update({ page_id: pageId, properties });
}

/**
 * Get all members (for CSV export)
 * Returns array of flat profile objects
 */
async function getAllMembers() {
  const members = [];
  let cursor;

  do {
    const params = { database_id: DB_ID, page_size: 100 };
    if (cursor) params.start_cursor = cursor;

    const resp = await notion.databases.query(params);
    for (const page of resp.results) {
      if (page.archived) continue;
      const p = page.properties;
      members.push({
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
      });
    }
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return members;
}

module.exports = { PROP, CSV_COL, findByEmail, getProfile, updateProfile, getAllMembers };
