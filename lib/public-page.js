/**
 * Référencement (2026-11) : ce que le bottin présente aux moteurs de recherche.
 *
 *  - Slugs des fiches publiques : la fin de l'adresse /membre/<slug>. Calculés
 *    ici, publiés dans la colonne « Slug » du CSV public ; index.html les lit.
 *  - Page de profil : index.html dont l'en-tête (titre, description, adresse
 *    canonique, données schema.org) décrit le profil, et dont la fiche est déjà
 *    ouverte dans le HTML. Une fois ses données chargées, la page reconstruit
 *    la fiche comme d'habitude : les visiteurs ne voient pas de différence, les
 *    robots lisent le profil sans exécuter de JavaScript.
 *  - Plan de site.
 *
 * Règle : jamais de courriel dans ce que ce fichier produit (décision de Tess,
 * 2026-11-21), même pour les membres qui affichent le leur dans le bottin.
 * Seuls les membres approuvés ayant consenti au profil public y passent.
 */

const SITE = 'https://bottin.rsn.quebec';
const SITE_NAME = 'Bottin du RSN';
const RSN = { '@type': 'Organization', name: 'Réseau santé numérique (RSN)', url: 'https://rsn.quebec/' };

// ─── Slugs ───
// fold et slugify : mêmes règles que dans index.html (repli quand le CSV n'a
// pas encore la colonne « Slug »). Les garder identiques.
function fold(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function slugify(s) {
  return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function baseSlug(m) {
  return slugify([m.prenom, m.nom].filter(Boolean).join(' ')) || 'membre';
}

function isPublicMember(m) {
  if (!m || (!m.prenom && !m.nom)) return false;
  if (m.workflow !== 'Approuvé') return false;
  return String(m.consent || '').toLowerCase().startsWith('oui');
}

// Donne un slug à chaque membre public. En cas d'homonymes, la fiche la plus
// ancienne garde l'adresse simple et les suivantes prennent « -2 », « -3 » :
// l'arrivée d'un homonyme ne change donc pas l'adresse d'une fiche existante.
// Le résultat ne dépend que des fiches portant le même nom, ce qui permet de
// le recalculer à partir d'une simple recherche par nom (voir slugLookupTokens).
function assignSlugs(publicMembers) {
  const groups = new Map();
  for (const m of publicMembers) {
    const b = baseSlug(m);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(m);
  }
  for (const [b, list] of groups) {
    list.sort((x, y) =>
      String(x.creeLe || '').localeCompare(String(y.creeLe || '')) || String(x.id).localeCompare(String(y.id)));
    list.forEach((m, i) => { m.slug = i === 0 ? b : `${b}-${i + 1}`; });
  }
  return publicMembers;
}

function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= 120;
}

// Mots à chercher dans Notion pour retrouver la fiche d'un slug : le premier
// (dans le prénom) et le dernier (dans le nom), suffixe d'homonyme mis à part.
// null quand le slug n'a qu'un mot : l'appelant passe alors par la lecture complète.
function slugLookupTokens(slug) {
  const tokens = slug.split('-');
  if (tokens.length > 2 && /^\d+$/.test(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length < 2) return null;
  return { first: tokens[0], last: tokens[tokens.length - 1] };
}

// ─── Échappement ───
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// JSON placé dans une balise <script> : aucun « < » ne doit rester lisible,
// sinon un texte saisi par un membre pourrait refermer la balise.
function jsonForScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
function httpUrl(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  } catch (e) {
    return '';
  }
}
function orcidUrl(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  const id = v.match(/\d{4}-\d{4}-\d{4}-\d{3}[\dXx]/);
  return id ? `https://orcid.org/${id[0].toUpperCase()}` : httpUrl(v);
}
function truncate(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–—-]+$/, '') + '…';
}

// ─── Données d'un profil ───
function fullName(m) {
  return [m.prenom, m.nom].filter(Boolean).join(' ').trim();
}
function displayName(m) {
  const p = String(m.prenom || '').trim(), n = String(m.nom || '').trim();
  if (!p) return n.toUpperCase();
  if (!n) return p;
  return `${p} ${n.toUpperCase()}`;
}
function institutionsOf(m) {
  return String(m.institution || '').split(';').map(s => s.trim()).filter(Boolean);
}
function typeNorm(type) {
  const t = String(type || '');
  if (/r[ée]gulier/i.test(t)) return 'regulier';
  if (/[ée]tudiant/i.test(t)) return 'etudiant';
  if (/partenaire/i.test(t)) return 'partenaire';
  return 'autre';
}
// Thèmes : texte libre. On n'en fait une liste (schema.org knowsAbout) que s'il
// se découpe en éléments courts ; sinon on n'invente pas de structure.
function themeList(themes) {
  const parts = String(themes || '').split(/[,;\n•]+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (parts.length < 2 || parts.some(p => p.length > 90)) return [];
  return parts.slice(0, 20);
}
function photoPath(m) {
  return m.photoName
    ? `/api/photo?id=${String(m.id).replace(/-/g, '')}&v=${encodeURIComponent(m.photoName)}`
    : '';
}
function memberUrl(m) {
  return `${SITE}/membre/${m.slug}`;
}

// Titre : « Nom — Établissement | Bottin du RSN », tant qu'il tient en 70
// caractères (au-delà, les moteurs le coupent). Sinon le sigle de
// l'établissement (« RI-MUHC - Research Institute… » → « RI-MUHC »), sinon le nom seul.
function institutionSigle(inst) {
  const head = String(inst || '').split(' - ')[0].trim();
  return head && head !== inst && head.length <= 15 && !/\s/.test(head) ? head : '';
}
function pageTitle(m) {
  const name = fullName(m);
  const inst = institutionsOf(m)[0];
  for (const label of [inst, institutionSigle(inst)]) {
    const t = label ? `${name} — ${label} | ${SITE_NAME}` : '';
    if (t && t.length <= 70) return t;
  }
  return `${name} — ${SITE_NAME}`;
}
function pageDescription(m) {
  const head = [m.statut, institutionsOf(m)[0]].filter(Boolean).join(', ');
  // sans la ponctuation qu'un membre aurait laissee en fin de liste (« a, b, »)
  const themes = String(m.themes || '').replace(/\s+/g, ' ').trim().replace(/[\s,;:]+$/, '');
  let d = fullName(m) + (head ? ` — ${head}.` : ', membre du Réseau santé numérique (RSN).');
  if (themes) d += ` Thèmes : ${themes}`;
  return truncate(d, 160);
}

function profileJsonLd(m) {
  const url = memberUrl(m);
  const person = { '@type': 'Person', name: fullName(m), url };
  if (m.prenom) person.givenName = m.prenom;
  if (m.nom) person.familyName = m.nom;
  const desc = [m.statut, truncate(m.projet, 300)].filter(Boolean).join(' — ');
  if (desc) person.description = desc;
  const photo = photoPath(m);
  if (photo) person.image = SITE + photo;
  const insts = institutionsOf(m);
  if (insts.length) person.affiliation = insts.map(name => ({ '@type': 'Organization', name }));
  const themes = themeList(m.themes);
  if (themes.length) person.knowsAbout = themes;
  const sameAs = [orcidUrl(m.orcid), httpUrl(m.cv)].filter(Boolean);
  if (sameAs.length) person.sameAs = sameAs;
  person.memberOf = RSN;
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url,
    inLanguage: 'fr-CA',
    isPartOf: { '@type': 'WebSite', name: 'Bottin des membres du Réseau santé numérique', url: `${SITE}/` },
    mainEntity: person,
  };
}

// ─── Fiche déjà ouverte dans le HTML ───
// Mêmes classes que la fiche construite par showMemberPopup dans index.html,
// sans le courriel ni les blocs interactifs, que la page ajoute elle-même.
function chipsHtml(m) {
  const chips = [];
  (m.axes || []).forEach(a => chips.push(`<span class="axe-chip">${esc(String(a).replace(/^(Axe|Axis) \d+ - /, ''))}</span>`));
  (m.principes || []).forEach(p => chips.push(`<span class="principe-chip">${esc(p)}</span>`));
  (m.champs || []).forEach(c => chips.push(`<span class="action-chip">${esc(c)}</span>`));
  return chips.length ? `<div class="card-chips-row">${chips.join('')}</div>` : '';
}
function modalHtml(m) {
  const name = fullName(m);
  const photo = photoPath(m);
  const nameHtml = `<h2 class="card-name">${esc(displayName(m))}</h2>`;
  const tag = `<span class="card-tag tag-${typeNorm(m.type)}">${esc(m.type || 'N/A')}</span>`;
  const header = photo
    ? `<div class="card-header"><div class="card-identity"><img class="card-photo card-photo-lg" src="${esc(photo)}" alt="Photo de ${esc(name)}" onerror="this.remove()">${nameHtml}</div>${tag}</div>`
    : `<div class="card-header">${nameHtml}${tag}</div>`;
  const insts = institutionsOf(m);
  const details = [];
  if (m.statut) details.push(`<div class="card-detail"><span class="dl">Statut</span><span>${esc(m.statut)}</span></div>`);
  if (m.themes) details.push(`<div class="card-detail"><span class="dl">Thèmes</span><div style="min-width:0;flex:1"><div class="card-clamp">${esc(m.themes)}</div></div></div>`);
  if (m.reseau) details.push(`<div class="card-detail"><span class="dl">Réseau</span><span>${esc(m.reseau)}</span></div>`);
  if (m.projet) details.push(`<div class="card-detail" style="flex-direction:column;gap:0.15rem"><span class="dl">Présentation</span><div class="card-clamp">${esc(m.projet)}</div></div>`);
  const links = [];
  const orcid = orcidUrl(m.orcid);
  if (orcid) links.push(`<a class="card-link" href="${esc(orcid)}" target="_blank" rel="noopener">ORCID</a>`);
  const site = httpUrl(m.cv);
  if (site) links.push(`<a class="card-link" href="${esc(site)}" target="_blank" rel="noopener">Site web</a>`);
  return [
    '<div class="member-overlay active" id="memberOverlay" onclick="if(event.target===this)closeMemberPopup()">',
    '    <div class="member-modal" id="memberModalContent">',
    '        <button class="member-modal-close" onclick="closeMemberPopup()">&times;</button>',
    '        <div>',
    header,
    `<div class="card-institution" style="margin:.5rem 0">${insts.length ? insts.map(esc).join('<br>') : 'Institution non renseignée'}</div>`,
    `<div class="card-details" style="margin-top:.75rem">${details.join('')}</div>`,
    chipsHtml(m),
    links.length ? `<div class="card-links">${links.join('')}</div>` : '',
    '        </div>',
    '    </div>',
    '</div>',
  ].join('\n');
}

// ─── Assemblage de la page ───
// Chaque remplacement doit trouver son repère une fois exactement. Si
// index.html a changé et qu'un repère manque, on le signale et on continue :
// la page reste utilisable, il lui manque seulement cette information.
const OVERLAY_RE = /<div class="member-overlay" id="memberOverlay"[^>]*>\s*<div class="member-modal" id="memberModalContent">\s*<button class="member-modal-close"[^>]*>[^<]*<\/button>\s*<\/div>\s*<\/div>/;
function replaceOnce(html, re, replacement, label, missing) {
  let n = 0;
  const out = html.replace(re, () => { n++; return replacement; });
  if (n !== 1) { missing.push(label); return html; }
  return out;
}
function metaRe(attr, key) {
  return new RegExp(`<meta ${attr}="${key}" content="[^"]*">`);
}

function renderMemberPage(indexHtml, m) {
  const missing = [];
  const url = memberUrl(m);
  const title = pageTitle(m);
  const desc = pageDescription(m);
  let html = indexHtml;
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`, 'title', missing);
  html = replaceOnce(html, metaRe('name', 'description'), `<meta name="description" content="${esc(desc)}">`, 'description', missing);
  html = replaceOnce(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(url)}">`, 'canonical', missing);
  html = replaceOnce(html, metaRe('property', 'og:type'), '<meta property="og:type" content="profile">', 'og:type', missing);
  html = replaceOnce(html, metaRe('property', 'og:url'), `<meta property="og:url" content="${esc(url)}">`, 'og:url', missing);
  html = replaceOnce(html, metaRe('property', 'og:title'), `<meta property="og:title" content="${esc(title)}">`, 'og:title', missing);
  html = replaceOnce(html, metaRe('property', 'og:description'), `<meta property="og:description" content="${esc(desc)}">`, 'og:description', missing);
  html = replaceOnce(html, metaRe('name', 'twitter:title'), `<meta name="twitter:title" content="${esc(title)}">`, 'twitter:title', missing);
  html = replaceOnce(html, metaRe('name', 'twitter:description'), `<meta name="twitter:description" content="${esc(desc)}">`, 'twitter:description', missing);
  // Les données schema.org de l'accueil (site, réseau) laissent la place à celles du profil.
  html = html.replace(/<script type="application\/ld\+json" id="ldHome">[\s\S]*?<\/script>\s*/, '');
  html = replaceOnce(html, /<\/head>/, `<script type="application/ld+json" id="ldProfile">${jsonForScript(profileJsonLd(m))}</script>\n</head>`, 'head', missing);
  html = replaceOnce(html, OVERLAY_RE, modalHtml(m), 'fiche', missing);
  return { html, missing };
}

// Adresse /membre/… sans profil public : la page d'accueil, signalée aux
// moteurs comme à ne pas indexer (le serveur répond 404).
function renderNotFoundPage(indexHtml) {
  return indexHtml.replace(/<\/head>/, () => '<meta name="robots" content="noindex">\n</head>');
}

function renderSitemap(publicMembers) {
  const urls = [`${SITE}/`].concat(
    publicMembers.filter(m => m.slug).map(memberUrl).sort());
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(u => `<url><loc>${esc(u)}</loc></url>`).join('\n')
    + '\n</urlset>\n';
}

module.exports = {
  SITE, fold, slugify, baseSlug, isPublicMember, assignSlugs, isValidSlug, slugLookupTokens,
  renderMemberPage, renderNotFoundPage, renderSitemap,
  // exposés pour les vérifications
  pageTitle, pageDescription, profileJsonLd, modalHtml,
};
