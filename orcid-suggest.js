/**
 * OrcidSuggest — propose des mots-clés à partir du profil ORCID public d'une
 * personne, pour remplir un champ texte (thèmes d'intérêt / expertise).
 * Partagé par join.html et edit.html. Aucune dépendance, aucun appel serveur :
 * le navigateur interroge directement deux API publiques qui acceptent les
 * appels inter-sites (CORS) :
 *   - ORCID public API   : mots-clés déclarés par la personne sur son profil
 *   - OpenAlex           : thèmes de recherche calculés à partir des publications
 *
 * La personne voit les suggestions sous forme de puces, coche celles qu'elle
 * veut, puis les ajoute au champ. Rien n'est écrit sans son choix explicite.
 *
 * Usage :
 *   var os = OrcidSuggest.mount({
 *     root:   document.getElementById('orcidSuggestRoot'),
 *     input:  document.getElementById('f_orcid'),     // champ ORCID
 *     target: document.getElementById('f_themes'),    // champ texte à compléter
 *     labels: { button, loading, notFound, empty, network, pick, add, added, source, hint },
 *   });
 *   os.setLabels({...})   // changement de langue
 */
(function (global) {
  'use strict';

  var MAX_SUGGESTIONS = 12;
  var OPENALEX_TOPICS = 8;      // thèmes OpenAlex les plus fréquents retenus
  var OPENALEX_MIN_COUNT = 2;   // un thème vu sur 1 seule publication n'est pas retenu

  var CSS = [
    '.os-wrap{margin-top:.5rem;display:flex;flex-direction:column;gap:.5rem}',
    '.os-btn{align-self:flex-start;padding:.4rem .9rem;border-radius:.5rem;border:1.5px solid var(--primary,#2b6cb0);',
    '  background:transparent;color:var(--primary,#2b6cb0);font-size:.85rem;font-weight:600;cursor:pointer;font-family:inherit}',
    '.os-btn:hover{background:var(--primary,#2b6cb0);color:#fff}',
    '.os-btn:disabled{opacity:.5;cursor:not-allowed}',
    '.os-btn:disabled:hover{background:transparent;color:var(--primary,#2b6cb0)}',
    '.os-status{font-size:.8rem;color:var(--muted,#718096)}',
    '.os-status.os-err{color:var(--error,#e53e3e)}',
    '.os-panel{border:1.5px solid var(--border,#e2e8f0);border-radius:.5rem;padding:.75rem;background:var(--bg,#f7fafc)}',
    '.os-pick{font-size:.8rem;color:var(--text,#1a202c);margin-bottom:.5rem}',
    '.os-chips{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.6rem}',
    '.os-chip{padding:.3rem .7rem;border-radius:2rem;font-size:.8rem;border:1.5px solid var(--border,#e2e8f0);',
    '  background:var(--card,#fff);color:var(--text,#1a202c);cursor:pointer;font-family:inherit;transition:all .15s}',
    '.os-chip[aria-pressed="true"]{background:var(--primary,#2b6cb0);color:#fff;border-color:var(--primary,#2b6cb0)}',
    '.os-chip .os-src{opacity:.6;font-size:.7em;margin-left:.3rem}',
    '.os-add{padding:.4rem .9rem;border-radius:.5rem;border:none;background:var(--primary,#2b6cb0);color:#fff;',
    '  font-size:.85rem;font-weight:600;cursor:pointer;font-family:inherit}',
    '.os-add:disabled{opacity:.5;cursor:not-allowed}',
    '.os-source{font-size:.72rem;color:var(--muted,#718096);font-style:italic;margin-top:.5rem}'
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

  // "https://orcid.org/0000-0002-1825-0097" ou "0000-0002-1825-0097" -> identifiant, sinon null
  function parseOrcid(value) {
    var m = String(value || '').match(/\d{4}-\d{4}-\d{4}-\d{3}[\dXx]/);
    return m ? m[0].toUpperCase() : null;
  }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function fetchJson(url, headers) {
    return fetch(url, { headers: headers || {} }).then(function (r) {
      if (r.status === 404) return { _notFound: true };
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // Mots-clés déclarés sur le profil ORCID public
  function fetchOrcidKeywords(id) {
    return fetchJson('https://pub.orcid.org/v3.0/' + id + '/keywords', { 'Accept': 'application/json' })
      .then(function (d) {
        if (d._notFound) return { notFound: true, items: [] };
        var items = (d.keyword || []).map(function (k) { return k.content; }).filter(Boolean);
        return { notFound: false, items: items };
      });
  }

  // Nom de la personne sur ORCID, pour vérifier qu'OpenAlex parle bien d'elle
  function fetchOrcidName(id) {
    return fetchJson('https://pub.orcid.org/v3.0/' + id + '/person', { 'Accept': 'application/json' })
      .then(function (d) {
        if (d._notFound) return { notFound: true, family: '' };
        var n = d.name || {};
        return { notFound: false, family: (n['family-name'] && n['family-name'].value) || '' };
      })
      .catch(function () { return { notFound: false, family: '' }; });
  }

  // Thèmes de recherche OpenAlex (calculés à partir des publications).
  // OpenAlex répond parfois pour un ORCID inexistant, ou rattache un ORCID à
  // la mauvaise personne : on ne garde ses thèmes que si le nom de famille
  // ORCID apparaît dans le nom OpenAlex.
  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
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
      .catch(function () { return []; }); // OpenAlex indisponible : on garde les mots-clés ORCID
  }

  function mount(opts) {
    injectCss();
    var root = opts.root, input = opts.input, target = opts.target;
    var labels = opts.labels || {};

    var wrap = el('div', 'os-wrap');
    var btn = el('button', 'os-btn'); btn.type = 'button';
    var status = el('div', 'os-status');
    var panel = el('div', 'os-panel'); panel.style.display = 'none';
    var pick = el('div', 'os-pick');
    var chips = el('div', 'os-chips');
    var addBtn = el('button', 'os-add'); addBtn.type = 'button';
    var source = el('div', 'os-source');
    panel.appendChild(pick); panel.appendChild(chips); panel.appendChild(addBtn); panel.appendChild(source);
    wrap.appendChild(btn); wrap.appendChild(status); wrap.appendChild(panel);
    root.appendChild(wrap);

    var suggestions = []; // [{ text, src: 'orcid'|'openalex', selected }]

    function setLabels(l) {
      labels = l || labels;
      btn.textContent = labels.button || 'Suggérer des mots-clés depuis mon ORCID';
      pick.textContent = labels.pick || 'Cochez les mots-clés à garder :';
      source.textContent = labels.source || '';
      updateAddBtn();
    }

    function setStatus(text, isError) {
      status.textContent = text || '';
      status.className = 'os-status' + (isError ? ' os-err' : '');
    }

    function updateButton() {
      btn.disabled = !parseOrcid(input.value);
    }

    function updateAddBtn() {
      var n = suggestions.filter(function (s) { return s.selected; }).length;
      addBtn.disabled = n === 0;
      addBtn.textContent = (labels.add || 'Ajouter au champ') + (n ? ' (' + n + ')' : '');
    }

    // Valeurs déjà présentes dans le champ cible (séparées par virgules / points-virgules / retours)
    function existingValues() {
      return norm(target.value).split(/[,;\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    }

    function renderChips() {
      while (chips.firstChild) chips.removeChild(chips.firstChild);
      suggestions.forEach(function (s) {
        var c = el('button', 'os-chip', s.text);
        c.type = 'button';
        c.setAttribute('aria-pressed', s.selected ? 'true' : 'false');
        var tag = el('span', 'os-src', s.src === 'orcid' ? 'ORCID' : 'OpenAlex');
        c.appendChild(tag);
        c.addEventListener('click', function () {
          s.selected = !s.selected;
          c.setAttribute('aria-pressed', s.selected ? 'true' : 'false');
          updateAddBtn();
        });
        chips.appendChild(c);
      });
      updateAddBtn();
    }

    function suggest() {
      var id = parseOrcid(input.value);
      if (!id) return;
      btn.disabled = true;
      panel.style.display = 'none';
      setStatus(labels.loading || 'Recherche en cours…');
      Promise.all([fetchOrcidKeywords(id), fetchOrcidName(id)]).then(function (res) {
        var orcid = res[0], person = res[1];
        if (orcid.notFound || person.notFound) {
          setStatus(labels.notFound || 'Aucun profil ORCID public trouvé pour cet identifiant.', true);
          return null;
        }
        return fetchOpenAlexTopics(id, person.family).then(function (topics) { return { orcid: orcid, topics: topics }; });
      }).then(function (res) {
        if (!res) return;
        var orcid = res.orcid, topics = res.topics;
        var seen = {};
        existingValues().forEach(function (v) { seen[v] = true; });
        suggestions = [];
        function push(text, src) {
          var k = norm(text);
          if (!k || seen[k] || suggestions.length >= MAX_SUGGESTIONS) return;
          seen[k] = true;
          suggestions.push({ text: String(text).trim(), src: src, selected: false });
        }
        orcid.items.forEach(function (t) { push(t, 'orcid'); });
        topics.forEach(function (t) { push(t, 'openalex'); });
        if (suggestions.length === 0) {
          setStatus(labels.empty || 'Votre profil ORCID public ne contient pas encore de mots-clés exploitables.', false);
          return;
        }
        setStatus('');
        renderChips();
        panel.style.display = 'block';
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
      if (!suggestions.length) panel.style.display = 'none';
      setStatus((labels.added || 'Ajouté au champ.') + ' ' + picked.join(', '));
      target.focus();
    });

    btn.addEventListener('click', suggest);
    input.addEventListener('input', updateButton);
    input.addEventListener('change', updateButton);

    setLabels(labels);
    updateButton();
    return { setLabels: setLabels, refresh: updateButton, parseOrcid: parseOrcid };
  }

  global.OrcidSuggest = { mount: mount, parseOrcid: parseOrcid };
})(window);
