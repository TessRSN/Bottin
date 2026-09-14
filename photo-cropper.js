/**
 * PhotoCropper — cadrage carré d'une photo de profil, côté navigateur,
 * sans dépendance. Partagé par join.html et edit.html.
 *
 * Usage :
 *   var pc = PhotoCropper.mount({
 *     root:   document.getElementById('photoCropper'),   // conteneur vide
 *     input:  document.getElementById('f_photo'),        // <input type="file"> (caché)
 *     labels: { choose, change, remove, zoom, drag, errType, errSize },
 *   });
 *   pc.getDataUrl()   -> 'data:image/jpeg;base64,...' (carré 512 px) ou null
 *   pc.isRemoved()    -> true si la personne a retiré sa photo existante
 *   pc.setExisting(u) -> affiche la photo actuelle (page Mettre à jour)
 *   pc.setLabels({})  -> retraduit les boutons (changement de langue)
 *
 * La personne déplace la photo (glisser) et zoome (curseur) dans un cadre
 * carré ; ce qui est envoyé est déjà carré, donc affiché en rond partout
 * sans surprise de cadrage. Notion n'offre aucun recadrage.
 */
(function (global) {
  'use strict';

  var VIEW = 220;        // taille du cadre à l'écran (px)
  var OUT = 512;         // taille de l'image envoyée (px)
  var MAX_ZOOM = 3;
  var MAX_FILE = 15 * 1024 * 1024; // 15 Mo côté navigateur
  var TYPES = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1 };

  var CSS = [
    '.pc-wrap{display:flex;flex-direction:column;gap:.6rem;align-items:flex-start}',
    '.pc-frame{position:relative;width:' + VIEW + 'px;height:' + VIEW + 'px;border-radius:50%;overflow:hidden;',
    '  border:2px solid var(--border,#e2e8f0);background:var(--bg,#f7fafc);touch-action:none;cursor:grab;user-select:none}',
    '.pc-frame.dragging{cursor:grabbing}',
    '.pc-frame canvas{display:block;width:100%;height:100%}',
    '.pc-existing{width:' + VIEW + 'px;height:' + VIEW + 'px;border-radius:50%;object-fit:cover;border:2px solid var(--border,#e2e8f0);display:block}',
    '.pc-controls{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}',
    '.pc-zoom-label{display:flex;align-items:center;gap:.5rem;font-size:.8rem;color:var(--muted,#718096)}',
    '.pc-zoom{width:140px;margin:0}',
    '.pc-btn{padding:.4rem .9rem;border-radius:.5rem;border:1.5px solid var(--primary,#2b6cb0);background:transparent;',
    '  color:var(--primary,#2b6cb0);font-size:.85rem;font-weight:600;cursor:pointer;font-family:inherit}',
    '.pc-btn:hover{background:var(--primary,#2b6cb0);color:#fff}',
    '.pc-btn.pc-danger{border-color:var(--muted,#718096);color:var(--muted,#718096)}',
    '.pc-btn.pc-danger:hover{background:var(--muted,#718096);color:#fff}',
    '.pc-hint{font-size:.75rem;color:var(--muted,#718096);font-style:italic}',
    '.pc-error{font-size:.8rem;color:var(--error,#e53e3e)}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('pc-style')) return;
    var s = document.createElement('style');
    s.id = 'pc-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function mount(opts) {
    injectCss();
    var root = opts.root, input = opts.input;
    var labels = opts.labels || {};
    var state = { img: null, base: 1, zoom: 1, ox: 0, oy: 0, existing: null, removed: false };

    var wrap = el('div', 'pc-wrap');
    var frame = el('div', 'pc-frame');
    var canvas = document.createElement('canvas');
    canvas.width = VIEW; canvas.height = VIEW;
    frame.appendChild(canvas);
    var existingImg = el('img', 'pc-existing');
    existingImg.alt = '';
    var controls = el('div', 'pc-controls');
    var chooseBtn = el('button', 'pc-btn'); chooseBtn.type = 'button';
    var removeBtn = el('button', 'pc-btn pc-danger'); removeBtn.type = 'button';
    var zoomLabel = el('label', 'pc-zoom-label');
    var zoomText = el('span');
    var zoom = document.createElement('input');
    zoom.type = 'range'; zoom.min = '1'; zoom.max = String(MAX_ZOOM); zoom.step = '0.01'; zoom.value = '1';
    zoom.className = 'pc-zoom';
    zoomLabel.appendChild(zoomText); zoomLabel.appendChild(zoom);
    var hint = el('div', 'pc-hint');
    var error = el('div', 'pc-error');

    controls.appendChild(chooseBtn);
    controls.appendChild(zoomLabel);
    controls.appendChild(removeBtn);
    wrap.appendChild(existingImg);
    wrap.appendChild(frame);
    wrap.appendChild(controls);
    wrap.appendChild(hint);
    wrap.appendChild(error);
    root.appendChild(wrap);

    function setLabels(l) {
      labels = l || labels;
      chooseBtn.textContent = (state.img || state.existing) ? (labels.change || 'Changer') : (labels.choose || 'Choisir une photo');
      removeBtn.textContent = labels.remove || 'Retirer';
      zoomText.textContent = labels.zoom || 'Zoom';
      hint.textContent = labels.drag || '';
    }

    function render() {
      var hasNew = !!state.img, hasExisting = !!state.existing && !hasNew;
      frame.style.display = hasNew ? 'block' : 'none';
      existingImg.style.display = hasExisting ? 'block' : 'none';
      zoomLabel.style.display = hasNew ? 'flex' : 'none';
      removeBtn.style.display = (hasNew || hasExisting) ? 'inline-block' : 'none';
      hint.style.display = hasNew ? 'block' : 'none';
      setLabels(labels);
      if (hasNew) draw();
    }

    // Dimensions de l'image affichée dans le cadre, avec zoom courant
    function drawn() {
      var s = state.base * state.zoom;
      return { w: state.img.width * s, h: state.img.height * s };
    }

    // L'image doit toujours couvrir le cadre : on borne les décalages
    function clamp() {
      var d = drawn();
      state.ox = Math.min(0, Math.max(VIEW - d.w, state.ox));
      state.oy = Math.min(0, Math.max(VIEW - d.h, state.oy));
    }

    function draw() {
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, VIEW, VIEW);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, VIEW, VIEW);
      var d = drawn();
      ctx.drawImage(state.img, state.ox, state.oy, d.w, d.h);
    }

    function loadFile(file) {
      error.textContent = '';
      if (!file) return;
      if (!TYPES[file.type]) { error.textContent = labels.errType || 'Format non pris en charge.'; return; }
      if (file.size > MAX_FILE) { error.textContent = labels.errSize || 'Photo trop lourde.'; return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        state.img = img;
        state.removed = false;
        state.base = VIEW / Math.min(img.width, img.height); // couvre le cadre
        state.zoom = 1;
        zoom.value = '1';
        var d = drawn();
        state.ox = (VIEW - d.w) / 2;
        state.oy = (VIEW - d.h) / 2;
        render();
      };
      img.onerror = function () { URL.revokeObjectURL(url); error.textContent = labels.errType || 'Image illisible.'; };
      img.src = url;
    }

    // Glisser pour recadrer (souris et tactile via Pointer Events)
    var drag = null;
    frame.addEventListener('pointerdown', function (e) {
      if (!state.img) return;
      drag = { x: e.clientX, y: e.clientY, ox: state.ox, oy: state.oy };
      frame.classList.add('dragging');
      frame.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    frame.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var rect = frame.getBoundingClientRect();
      var k = VIEW / rect.width; // le cadre peut être réduit en CSS sur mobile
      state.ox = drag.ox + (e.clientX - drag.x) * k;
      state.oy = drag.oy + (e.clientY - drag.y) * k;
      clamp(); draw();
    });
    function endDrag() { drag = null; frame.classList.remove('dragging'); }
    frame.addEventListener('pointerup', endDrag);
    frame.addEventListener('pointercancel', endDrag);

    // Zoom autour du centre du cadre
    zoom.addEventListener('input', function () {
      if (!state.img) return;
      var before = drawn();
      var cx = (VIEW / 2 - state.ox) / before.w, cy = (VIEW / 2 - state.oy) / before.h;
      state.zoom = parseFloat(zoom.value) || 1;
      var after = drawn();
      state.ox = VIEW / 2 - cx * after.w;
      state.oy = VIEW / 2 - cy * after.h;
      clamp(); draw();
    });

    chooseBtn.addEventListener('click', function () { input.value = ''; input.click(); });
    input.addEventListener('change', function () { loadFile(input.files && input.files[0]); });
    removeBtn.addEventListener('click', function () {
      state.img = null;
      if (state.existing) { state.existing = null; state.removed = true; }
      error.textContent = '';
      render();
    });

    function getDataUrl() {
      if (!state.img) return null;
      var out = document.createElement('canvas');
      out.width = OUT; out.height = OUT;
      var ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, OUT, OUT);
      var k = OUT / VIEW, d = drawn();
      ctx.drawImage(state.img, state.ox * k, state.oy * k, d.w * k, d.h * k);
      return out.toDataURL('image/jpeg', 0.85);
    }

    function setExisting(url) {
      state.existing = url || null;
      state.removed = false;
      existingImg.src = url || '';
      render();
    }

    render();
    return {
      getDataUrl: getDataUrl,
      hasNewPhoto: function () { return !!state.img; },
      isRemoved: function () { return state.removed; },
      setExisting: setExisting,
      setLabels: setLabels,
      clear: function () { state.img = null; state.existing = null; state.removed = false; render(); },
    };
  }

  global.PhotoCropper = { mount: mount };
})(window);
