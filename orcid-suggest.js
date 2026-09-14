/**
 * OrcidSuggest — propose, à partir du profil ORCID public d'une personne,
 * des mots-clés pour le champ « thèmes de recherche ou d'intérêt », et sa
 * biographie ORCID comme point de départ du champ « projet de recherche ».
 * Partagé par join.html et edit.html. Aucune dépendance, aucun appel serveur :
 * le navigateur interroge directement des API publiques ouvertes aux appels
 * inter-sites (CORS) :
 *   - ORCID public API : mots-clés déclarés, nom, biographie, DOI des publications
 *   - OpenAlex         : thèmes de la fiche auteur ; et, publication par publication,
 *                        thème principal, mots-clés et termes MeSH (PubMed)
 * Quand le profil n'a ni mots-clés ni publications mais une biographie, des
 * expressions en sont extraites (fréquence et expressions en majuscules),
 * sans IA.
 *
 * La personne voit les suggestions, choisit, puis les ajoute. Rien n'est
 * écrit sans son choix explicite.
 *
 * Usage :
 *   var os = OrcidSuggest.mount({
 *     root:    document.getElementById('orcidSuggestRoot'),
 *     input:   document.getElementById('f_orcid'),     // champ ORCID
 *     target:  document.getElementById('f_themes'),    // champ texte des mots-clés
 *     labels:  { button, loading, notFound, empty, network, pick, add, added, source,
 *                publications, mesh, bioSrc, bio, bioUse, bioFilled,
 *                bioTargets: [{ el, label }] }        // champs pouvant recevoir la biographie
 *   });
 *   os.setLabels({...})   // changement de langue (bioTargets inclus)
 */
(function (global) {
  'use strict';

  var MAX_SUGGESTIONS = 14;
  var OPENALEX_TOPICS = 8;      // thèmes OpenAlex (fiche auteur) les plus fréquents retenus
  var OPENALEX_MIN_COUNT = 2;   // un thème vu sur 1 seule publication n'est pas retenu
  var MAX_DOIS = 40;
  var BIO_KEYWORDS = 10;
  var BIO_PREVIEW = 320;

  var CSS = [
    '.os-wrap{margin-top:.5rem;display:flex;flex-direction:column;gap:.5rem}',
    '.os-btn{align-self:flex-start;padding:.55rem 1.1rem;border-radius:.5rem;border:none;',
    '  background:var(--primary,#2b6cb0);color:#fff;font-size:.9rem;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity .2s}',
    '.os-btn:hover{opacity:.85}',
    '.os-btn:disabled{opacity:.5;cursor:not-allowed}',
    '.os-status{font-size:.8rem;color:var(--muted,#718096)}',
    '.os-status.os-err{color:var(--error,#e53e3e)}',
    '.os-panel{border:1.5px solid var(--border,#e2e8f0);border-radius:.5rem;padding:.75rem;background:var(--bg,#f7fafc);display:flex;flex-direction:column;gap:.75rem}',
    '.os-section{display:flex;flex-direction:column;gap:.4rem}',
    '.os-label{font-size:.8rem;color:var(--text,#1a202c);font-weight:600}',
    '.os-chips{display:flex;flex-wrap:wrap;gap:.4rem}',
    '.os-chip{padding:.3rem .7rem;border-radius:2rem;font-size:.8rem;border:1.5px solid var(--border,#e2e8f0);',
    '  background:var(--card,#fff);color:var(--text,#1a202c);cursor:pointer;font-family:inherit;transition:all .15s;text-align:left}',
    '.os-chip[aria-pressed="true"]{background:var(--primary,#2b6cb0);color:#fff;border-color:var(--primary,#2b6cb0)}',
    '.os-chip:disabled{opacity:.5;cursor:not-allowed}',
    '.os-chip .os-src{opacity:.6;font-size:.7em;margin-left:.3rem}',
    '.os-add{align-self:flex-start;padding:.4rem .9rem;border-radius:.5rem;border:none;background:var(--primary,#2b6cb0);color:#fff;',
    '  font-size:.85rem;font-weight:600;cursor:pointer;font-family:inherit}',
    '.os-add:disabled{opacity:.5;cursor:not-allowed}',
    '.os-bio{font-size:.8rem;line-height:1.5;color:var(--text,#1a202c);background:var(--card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:.4rem;padding:.5rem .65rem;white-space:pre-line}',
    '.os-row{display:flex;flex-wrap:wrap;gap:.4rem}',
    '.os-source{font-size:.72rem;color:var(--muted,#718096);font-style:italic}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('os-style')) return;
    var s = document.createElement('style');
    s.id = 'os-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // "https://orcid.org/0000-0002-1825-0097" ou "0000-0002-1825-0097" -> identifiant, sinon null
  function parseOrcid(value) {
    var m = String(value || '').match(/\d{4}-\d{4}-\d{4}-\d{3}[\dXx]/);
    return m ? m[0].toUpperCase() : null;
  }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function fetchJson(url, headers) {
    return fetch(url, { headers: headers || {} }).then(function (r) {
      if (r.status === 404) return { _notFound: true };
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ─── Sources ORCID ───

  function fetchOrcidKeywords(id) {
    return fetchJson('https://pub.orcid.org/v3.0/' + id + '/keywords', { 'Accept': 'application/json' })
      .then(function (d) {
        if (d._notFound) return { notFound: true, items: [] };
        var items = (d.keyword || []).map(function (k) { return k.content; }).filter(Boolean);
        return { notFound: false, items: items };
      });
  }

  function fetchOrcidPerson(id) {
    return fetchJson('https://pub.orcid.org/v3.0/' + id + '/person', { 'Accept': 'application/json' })
      .then(function (d) {
        if (d._notFound) return { notFound: true, family: '', given: '', bio: '' };
        var n = d.name || {};
        return {
          notFound: false,
          family: (n['family-name'] && n['family-name'].value) || '',
          given: (n['given-names'] && n['given-names'].value) || '',
          bio: ((d.biography || {}).content || '').trim(),
        };
      })
      .catch(function () { return { notFound: false, family: '', given: '', bio: '' }; });
  }

  function fetchOrcidDois(id) {
    return fetchJson('https://pub.orcid.org/v3.0/' + id + '/works', { 'Accept': 'application/json' })
      .then(function (d) {
        var dois = [], seen = {};
        ((d && d.group) || []).forEach(function (g) {
          var s = (g['work-summary'] || [])[0];
          var ids = ((s && s['external-ids']) || {})['external-id'] || [];
          ids.forEach(function (e) {
            if (e['external-id-type'] !== 'doi') return;
            var v = String(e['external-id-value'] || '').toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
            if (v && !seen[v] && dois.length < MAX_DOIS) { seen[v] = true; dois.push(v); }
          });
        });
        return dois;
      })
      .catch(function () { return []; });
  }

  // ─── Sources OpenAlex ───

  // Thèmes de la fiche auteur OpenAlex. OpenAlex répond parfois pour un ORCID
  // inexistant, ou rattache un ORCID à la mauvaise personne : on ne garde ses
  // thèmes que si le nom de famille ORCID apparaît dans le nom OpenAlex.
  function fetchOpenAlexTopics(id, family) {
    return fetchJson('https://api.openalex.org/authors/https://orcid.org/' + id + '?select=display_name,topics')
      .then(function (d) {
        if (d._notFound || !d.topics) return [];
        if (!family || fold(d.display_name).indexOf(fold(family)) < 0) return [];
        return d.topics
          .filter(function (t) { return (t.count || 0) >= OPENALEX_MIN_COUNT; })
          .slice(0, OPENALEX_TOPICS)
          .map(function (t) { return t.display_name; })
          .filter(Boolean);
      })
      .catch(function () { return []; });
  }

  var GENERIC_KEYWORDS = {
    'medicine': 1, 'population': 1, 'populations': 1, 'health care': 1, 'healthcare': 1, 'health': 1,
    'medline': 1, 'data collection': 1, 'descriptive statistics': 1, 'descriptive research': 1,
    'statistics': 1, 'research': 1, 'science': 1, 'biology': 1, 'psychology': 1, 'sociology': 1,
    'gerontology': 1, 'pediatrics': 1, 'family medicine': 1, 'internal medicine': 1, 'nursing': 1,
    'computer science': 1, 'engineering': 1, 'mathematics': 1, 'physics': 1, 'chemistry': 1,
    'political science': 1, 'economics': 1, 'business': 1, 'law': 1, 'philosophy': 1, 'geography': 1,
    'history': 1, 'art': 1, 'quality': 1, 'context': 1, 'process': 1, 'structure': 1, 'analysis': 1,
    'evaluation': 1, 'study': 1, 'data': 1, 'model': 1, 'models': 1, 'method': 1, 'methods': 1,
    'approach': 1, 'system': 1, 'systems': 1, 'technology': 1, 'information': 1, 'knowledge': 1,
    'management': 1, 'development': 1, 'intervention': 1, 'interventions': 1, 'patients': 1,
    'patient care': 1, 'care': 1, 'disease': 1, 'diseases': 1, 'sample size': 1, 'cross-sectional study': 1,
    'logistic regression': 1, 'regression analysis': 1, 'social science': 1, 'sociodemographic': 1,
  };

  // Termes MeSH de contexte (population, type d'étude, lieu) qui ne décrivent
  // pas une expertise. Les autres descripteurs majeurs sont gardés.
  var MESH_CHECKTAGS = {
    'humans': 1, 'animals': 1, 'male': 1, 'female': 1, 'adult': 1, 'aged': 1, 'aged, 80 and over': 1,
    'middle aged': 1, 'young adult': 1, 'adolescent': 1, 'child': 1, 'child, preschool': 1, 'infant': 1,
    'infant, newborn': 1, 'mice': 1, 'rats': 1, 'surveys and questionnaires': 1, 'cross-sectional studies': 1,
    'retrospective studies': 1, 'prospective studies': 1, 'cohort studies': 1, 'case-control studies': 1,
    'longitudinal studies': 1, 'follow-up studies': 1, 'pilot projects': 1, 'feasibility studies': 1,
    'reproducibility of results': 1, 'treatment outcome': 1, 'prognosis': 1, 'time factors': 1,
    'age factors': 1, 'sex factors': 1, 'risk factors': 1, 'qualitative research': 1,
    'interviews as topic': 1, 'focus groups': 1, 'quebec': 1, 'canada': 1, 'ontario': 1, 'united states': 1,
    'france': 1, 'europe': 1, 'pandemics': 1,
  };

  // "Vision, Low" -> "Low Vision" ; "Diabetes Mellitus, Type 2" -> "Type 2 Diabetes Mellitus"
  function meshLabel(name) {
    var m = String(name).match(/^([^,]+), ([^,]+)$/);
    return m ? (m[2] + ' ' + m[1]) : name;
  }

  // Publication par publication (OpenAlex, une requête pour tous les DOI) :
  //  - termes MeSH majeurs (PubMed), comptés sur les publications ;
  //  - thème principal OpenAlex, dès 1 publication ;
  //  - mots-clés OpenAlex, seulement s'ils reviennent sur >= 2 publications.
  function fetchPublicationTopics(dois) {
    if (!dois.length) return Promise.resolve({ mesh: [], topics: [], keywords: [] });
    var filter = 'doi:' + dois.join('|');
    var url = 'https://api.openalex.org/works?filter=' + encodeURIComponent(filter) + '&select=doi,keywords,primary_topic,mesh&per-page=50';
    return fetchJson(url).then(function (d) {
      var works = (d && d.results) || [];
      var mesh = {}, topics = {}, keywords = {}, label = {};
      works.forEach(function (w) {
        var seenMesh = {};
        (w.mesh || []).forEach(function (m) {
          if (!m.is_major_topic || !m.descriptor_name) return;
          var km = norm(m.descriptor_name);
          if (MESH_CHECKTAGS[km] || seenMesh[km]) return;
          seenMesh[km] = true;
          mesh[km] = (mesh[km] || 0) + 1; label[km] = meshLabel(m.descriptor_name);
        });
        var t = w.primary_topic && w.primary_topic.display_name;
        if (t) { var kt = norm(t); topics[kt] = (topics[kt] || 0) + 1; label[kt] = t; }
        (w.keywords || []).forEach(function (k) {
          var name = k.display_name || '';
          var kk = norm(name);
          if (!kk || GENERIC_KEYWORDS[kk] || name.indexOf('(') >= 0) return;
          keywords[kk] = (keywords[kk] || 0) + 1; label[kk] = name;
        });
      });
      function sorted(map, min) {
        return Object.keys(map).filter(function (k) { return map[k] >= min; })
          .sort(function (a, b) { return map[b] - map[a]; })
          .map(function (k) { return label[k]; });
      }
      return { mesh: sorted(mesh, 1), topics: sorted(topics, 1), keywords: sorted(keywords, 2) };
    }).catch(function () { return { mesh: [], topics: [], keywords: [] }; });
  }

  // ─── Extraction depuis la biographie (sans IA) ───
  // Deux signaux : (1) expressions de 2-3 mots qui reviennent au moins 2 fois,
  // ou mot seul revenant au moins 3 fois ; (2) expressions en majuscules de
  // 2 à 5 mots au milieu d'une phrase (« Orthopaedic Manual Therapy »).
  // Les mots de liaison, le vocabulaire de carrière, les lieux et le nom de
  // la personne sont écartés. Les candidats sont ensuite validés contre les
  // concepts OpenAlex (validateConcepts), ce qui élimine les noms de
  // personnes et les expressions qui ne sont pas des sujets de recherche.

  var BIO_STOP = {};
  ('le la les un une des du de d l et ou à a au aux en dans sur pour par avec sans sous vers chez ce cette ces ' +
   'son sa ses leur leurs mon ma mes notre nos votre vos qui que quoi dont où est sont été être avoir ai as ' +
   'ont fait faire plus moins très aussi comme ainsi entre depuis pendant après avant tout tous toute toutes ' +
   'il elle ils elles nous vous je tu on ne pas non oui même autre autres ' +
   'the a an and or of to in on at for with by from as is are was were be been being have has had do does did ' +
   'will would should could may might can this that these those it its he she his her they them their we our ' +
   'you your i my me not no yes also than then there such any some more most very into onto through between ' +
   'among within without against around across after before during over under while where when which who whom ' +
   'whose what how why all each other another same own so if but because about like via per ' +
   // carrière, formation, institutions, temps
   'phd ph msc ma bsc md dr pr prof professor professeur professeure lecturer assistant associate adjoint ' +
   'candidate candidat candidate student students étudiant étudiante étudiants researcher researchers chercheur ' +
   'chercheuse chercheurs research recherche recherches scientist university université universities faculty ' +
   'faculté department département school école institute institut institution institutions college hospital ' +
   'hôpital centre center laboratory laboratoire lab board federation foundation fondation member membre ' +
   'members membres director directeur directrice head chair chaire holder titulaire fellow postdoctoral ' +
   'postdoc degree diplôme master maîtrise doctorate doctorat doctoral thesis thèse dissertation ' +
   'publications publication published publié journal journals conference conferences award awards prize ' +
   'grant grants funding funded years year ans année années experience expérience currently actuellement ' +
   'current present presently interested intérêt interests interest focus focuses focused focusing field ' +
   'fields domaine domaines area areas work works working travail travaux career carrière international ' +
   'internationale national global worldwide various several many new novel main principal ' +
   'group groupe team équipe program programme project projects projet projets certified certificated ' +
   'certificate certification specialist spécialiste track tutor tutors instructor founder founders founded ' +
   'co-founder cofounder ambassador author authors textbook textbooks figures concept concepts ' +
   // lieux
   'canada canadian canadienne québec quebec québécois montréal montreal ontario toronto ottawa sherbrooke ' +
   'laval united states usa america american europe european france french paris london uk england'
  ).split(/\s+/).forEach(function (w) { if (w) BIO_STOP[w] = 1; });
  // « and » / « et » ne sont pas des connecteurs : ils separent deux expressions
  var BIO_CONNECTORS = { 'of': 1, 'de': 1, 'du': 1, 'des': 1, 'la': 1, 'le': 1, 'en': 1, 'à': 1, 'a': 1, 'for': 1, 'in': 1 };
  var BIO_CANDIDATES = 16;

  function keywordsFromBio(bio, names) {
    if (!bio) return [];
    var skip = {};
    (names || []).forEach(function (n) { String(n).split(/\s+/).forEach(function (w) { if (w) skip[fold(w)] = 1; }); });
    var sentences = bio.replace(/\s+/g, ' ').split(/[.!?;:\n()\[\]"“”*]+/);
    var counts = {}, caps = {}, label = {};
    function token(w) { return w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''); }
    function isConn(w) { return !!BIO_CONNECTORS[fold(w)]; }
    function isStop(w) { var k = fold(w); return !k || BIO_STOP[k] || skip[k] || /^\d+$/.test(k) || k.length < 3; }
    function remember(map, words) {
      var key = fold(words.join(' '));
      map[key] = (map[key] || 0) + 1;
      if (!label[key]) label[key] = words.join(' ');
    }

    sentences.forEach(function (sent) {
      var words = sent.split(/[\s,\/]+/).map(token).filter(Boolean);
      // (1) n-grammes de mots pleins (connecteurs tolérés à l'intérieur)
      for (var i = 0; i < words.length; i++) {
        if (isStop(words[i]) || isConn(words[i])) continue;
        for (var n = 1; n <= 3 && i + n <= words.length; n++) {
          var slice = words.slice(i, i + n), last = slice[n - 1];
          if (n > 1 && (isConn(last) || isStop(last))) { if (isConn(last)) continue; else break; }
          var inner = slice.slice(1, -1);
          if (inner.some(function (w) { return isStop(w) && !isConn(w); })) break;
          remember(counts, slice);
        }
      }
      // (2) expressions en majuscules de 2 à 5 mots, pas en début de phrase, sigles exclus
      var run = [], runStart = 0;
      function flush() {
        var full = run.filter(function (w) { return !isConn(w); });
        if (run.length >= 2 && run.length <= 5 && full.length >= 2 && runStart > 0 &&
            !full.some(isStop) && !isConn(run[0]) && !isConn(run[run.length - 1])) remember(caps, run);
        run = [];
      }
      for (var k = 0; k < words.length; k++) {
        var w = words[k];
        var isCap = /^\p{Lu}\p{Ll}/u.test(w);
        if (isCap || (run.length && isConn(w))) { if (!run.length) runStart = k; run.push(w); }
        else flush();
      }
      flush();
    });

    var picked = [];
    function take(key, score) {
      var k = fold(label[key]);
      if (GENERIC_KEYWORDS[k]) return;
      for (var i = 0; i < picked.length; i++) {
        var pk = fold(picked[i].text);
        if (pk === k || pk.indexOf(k) >= 0) return;        // déjà couvert par un terme plus long
        if (k.indexOf(pk) >= 0) { picked.splice(i, 1); i--; } // le nouveau, plus long, remplace
      }
      picked.push({ text: label[key], score: score });
    }
    Object.keys(caps).forEach(function (k) { take(k, 100 + caps[k] + k.split(' ').length); });
    Object.keys(counts)
      .filter(function (k) {
        var words = k.split(' ').length;
        return (words >= 2 && counts[k] >= 2) || (words === 1 && counts[k] >= 3 && k.length >= 6);
      })
      .sort(function (a, b) { return (counts[b] * b.split(' ').length) - (counts[a] * a.split(' ').length); })
      .forEach(function (k) { take(k, counts[k] * k.split(' ').length * 1.5); });
    return picked.sort(function (a, b) { return b.score - a.score; }).slice(0, BIO_CANDIDATES).map(function (p) { return p.text; });
  }

  // Validation contre les concepts OpenAlex, en une seule requête : un
  // candidat est gardé si un concept connu le contient (« Orthopaedic Manual
  // Therapy » via « Manual therapy ») ou s'il contient un concept d'au moins
  // deux mots. Les noms de personnes et les lieux n'ont pas de concept.
  function validateConcepts(cands) {
    cands = cands.filter(function (c) { return c && c.indexOf('|') < 0; }).slice(0, 12);
    if (!cands.length) return Promise.resolve([]);
    // Pour les expressions longues, on cherche aussi leurs deux derniers mots
    // (« Orthopaedic Manual Therapy » -> « Manual Therapy »), sinon le concept
    // contenu ne remonte pas dans les resultats.
    var terms = cands.slice();
    cands.forEach(function (c) {
      var w = c.split(' ').filter(function (x) { return !BIO_CONNECTORS[fold(x)]; });
      if (w.length >= 3) terms.push(w.slice(-2).join(' '));
    });
    var url = 'https://api.openalex.org/concepts?filter=' + encodeURIComponent('display_name.search:' + terms.join('|')) + '&select=display_name&per-page=100';
    return fetchJson(url).then(function (d) {
      var names = ((d && d.results) || []).map(function (c) { return fold(c.display_name); });
      return cands.filter(function (c) {
        var k = fold(c), multi = k.split(' ').length >= 2;
        return names.some(function (n) { return n.indexOf(k) >= 0 || (multi && n.split(' ').length >= 2 && k.indexOf(n) >= 0); });
      });
    }).catch(function () { return cands.filter(function (c) { return c.split(' ').length >= 2; }); });
  }

  // ─── Composant ───

  function mount(opts) {
    injectCss();
    var root = opts.root, input = opts.input, target = opts.target;
    var labels = opts.labels || {};

    var wrap = el('div', 'os-wrap');
    var btn = el('button', 'os-btn'); btn.type = 'button';
    var status = el('div', 'os-status');
    var panel = el('div', 'os-panel'); panel.style.display = 'none';
    // Section mots-clés
    var kwSec = el('div', 'os-section'); kwSec.style.display = 'none';
    var pick = el('div', 'os-label');
    var chips = el('div', 'os-chips');
    var addBtn = el('button', 'os-add'); addBtn.type = 'button';
    kwSec.appendChild(pick); kwSec.appendChild(chips); kwSec.appendChild(addBtn);
    // Section biographie
    var bioSec = el('div', 'os-section'); bioSec.style.display = 'none';
    var bioLabel = el('div', 'os-label');
    var bioText = el('div', 'os-bio');
    var bioRow = el('div', 'os-row');
    bioSec.appendChild(bioLabel); bioSec.appendChild(bioText); bioSec.appendChild(bioRow);
    var source = el('div', 'os-source');
    panel.appendChild(kwSec); panel.appendChild(bioSec); panel.appendChild(source);
    wrap.appendChild(btn); wrap.appendChild(status); wrap.appendChild(panel);
    root.appendChild(wrap);

    var suggestions = []; // [{ text, src, selected }]
    var bio = '';

    function srcLabel(src) {
      if (src === 'orcid') return 'ORCID';
      if (src === 'openalex') return 'OpenAlex';
      if (src === 'mesh') return labels.mesh || 'MeSH (PubMed)';
      if (src === 'bio') return labels.bioSrc || 'Biographie';
      return labels.publications || 'Publications';
    }

    function setLabels(l) {
      labels = l || labels;
      btn.textContent = labels.button || 'Suggérer des mots-clés depuis mon profil ORCID';
      pick.textContent = labels.pick || 'Cochez les mots-clés à garder :';
      bioLabel.textContent = labels.bio || 'Biographie de votre profil ORCID :';
      source.textContent = labels.source || '';
      updateAddBtn();
      renderChips();
      renderBio();
    }

    function setStatus(text, isError) {
      status.textContent = text || '';
      status.className = 'os-status' + (isError ? ' os-err' : '');
    }

    function updateButton() { btn.disabled = !parseOrcid(input.value); }

    function updateAddBtn() {
      var n = suggestions.filter(function (s) { return s.selected; }).length;
      addBtn.disabled = n === 0;
      addBtn.textContent = (labels.add || 'Ajouter au champ') + (n ? ' (' + n + ')' : '');
    }

    function existingValues() {
      return norm(target.value).split(/[,;\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    }

    function renderChips() {
      clear(chips);
      suggestions.forEach(function (s) {
        var c = el('button', 'os-chip', s.text);
        c.type = 'button';
        c.setAttribute('aria-pressed', s.selected ? 'true' : 'false');
        c.appendChild(el('span', 'os-src', srcLabel(s.src)));
        c.addEventListener('click', function () {
          s.selected = !s.selected;
          c.setAttribute('aria-pressed', s.selected ? 'true' : 'false');
          updateAddBtn();
        });
        chips.appendChild(c);
      });
      kwSec.style.display = suggestions.length ? 'flex' : 'none';
      updateAddBtn();
    }

    function renderBio() {
      clear(bioRow);
      var targets = labels.bioTargets || [];
      if (!bio || !targets.length) { bioSec.style.display = 'none'; return; }
      bioText.textContent = bio.length > BIO_PREVIEW ? bio.slice(0, BIO_PREVIEW).replace(/\s+\S*$/, '') + '…' : bio;
      targets.forEach(function (t) {
        if (!t || !t.el) return;
        var b = el('button', 'os-chip', (labels.bioUse || 'Utiliser comme {field}').replace('{field}', t.label || ''));
        b.type = 'button';
        if (t.el.value.trim()) { b.disabled = true; b.title = labels.bioFilled || 'Ce champ contient déjà du texte.'; }
        b.addEventListener('click', function () {
          t.el.value = bio;
          t.el.dispatchEvent(new Event('input', { bubbles: true }));
          setStatus((labels.added || 'Ajouté :') + ' ' + (t.label || ''));
          renderBio();
        });
        bioRow.appendChild(b);
      });
      bioSec.style.display = 'flex';
    }

    function showPanel() {
      var any = suggestions.length || (bio && (labels.bioTargets || []).length);
      panel.style.display = any ? 'flex' : 'none';
      return !!any;
    }

    function suggest() {
      var id = parseOrcid(input.value);
      if (!id) return;
      btn.disabled = true;
      panel.style.display = 'none';
      setStatus(labels.loading || 'Recherche en cours…');
      Promise.all([fetchOrcidKeywords(id), fetchOrcidPerson(id)]).then(function (res) {
        var orcid = res[0], person = res[1];
        if (orcid.notFound || person.notFound) {
          setStatus(labels.notFound || 'Aucun profil ORCID public trouvé pour cet identifiant.', true);
          return null;
        }
        bio = person.bio;
        return Promise.all([
          fetchOpenAlexTopics(id, person.family),
          fetchOrcidDois(id).then(fetchPublicationTopics),
        ]).then(function (r) { return { orcid: orcid, person: person, topics: r[0], pubs: r[1] }; });
      }).then(function (res) {
        if (!res) return;
        var seen = {};
        existingValues().forEach(function (v) { seen[v] = true; });
        suggestions = [];
        function push(text, src) {
          var k = norm(text);
          if (!k || seen[k] || suggestions.length >= MAX_SUGGESTIONS) return;
          seen[k] = true;
          suggestions.push({ text: String(text).trim(), src: src, selected: false });
        }
        res.orcid.items.forEach(function (t) { push(t, 'orcid'); });
        res.topics.forEach(function (t) { push(t, 'openalex'); });
        res.pubs.mesh.forEach(function (t) { push(t, 'mesh'); });
        res.pubs.topics.forEach(function (t) { push(t, 'publications'); });
        res.pubs.keywords.forEach(function (t) { push(t, 'publications'); });
        function finish() {
          renderChips(); renderBio();
          if (!showPanel()) {
            setStatus(labels.empty || 'Votre profil ORCID public ne contient pas encore de mots-clés exploitables.', false);
            return;
          }
          setStatus('');
        }
        // Biographie : seulement si les autres sources sont maigres. Les
        // expressions extraites sont validées contre les concepts OpenAlex
        // (écarte noms de personnes, lieux, tournures).
        if (suggestions.length < 6 && res.person.bio) {
          var cands = keywordsFromBio(res.person.bio, [res.person.given, res.person.family]);
          return validateConcepts(cands).then(function (ok) {
            ok.forEach(function (t) { push(t, 'bio'); });
            finish();
          });
        }
        finish();
      }).catch(function () {
        setStatus(labels.network || "Impossible de joindre ORCID pour le moment. Réessayez plus tard.", true);
      }).then(function () { updateButton(); });
    }

    addBtn.addEventListener('click', function () {
      var picked = suggestions.filter(function (s) { return s.selected; }).map(function (s) { return s.text; });
      if (!picked.length) return;
      var current = target.value.trim();
      var sep = current ? (/[,;]\s*$/.test(current) ? ' ' : ', ') : '';
      target.value = current + sep + picked.join(', ');
      target.dispatchEvent(new Event('input', { bubbles: true }));
      suggestions = suggestions.filter(function (s) { return !s.selected; });
      renderChips();
      showPanel();
      setStatus((labels.added || 'Ajouté :') + ' ' + picked.join(', '));
      target.focus();
    });

    btn.addEventListener('click', suggest);
    input.addEventListener('input', updateButton);
    input.addEventListener('change', updateButton);

    setLabels(labels);
    updateButton();
    return { setLabels: setLabels, refresh: updateButton, parseOrcid: parseOrcid };
  }

  global.OrcidSuggest = { mount: mount, parseOrcid: parseOrcid, keywordsFromBio: keywordsFromBio };
})(window);
