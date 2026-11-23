/* Statistiques de visite du bottin, avec GoatCounter (https://www.goatcounter.com).
   Sans témoins ni identifiant de visiteur : GoatCounter ne garde que des totaux par page,
   par provenance, par pays, par navigateur et par taille d'écran.

   Trois règles, à conserver si ce fichier est modifié :
   1. Rien n'est envoyé depuis une adresse qui porte un lien signé (?token=…). Les pages
      edit.html et renew.html ne chargent d'ailleurs pas ce fichier : le script de
      GoatCounter transmet toujours les paramètres de l'adresse.
   2. La page d'où l'on vient n'est transmise que si c'est un autre site : une adresse du
      bottin peut contenir un lien signé (retour au bottin depuis edit.html).
   3. Seul bottin.rsn.quebec est mesuré, ni les aperçus Vercel ni les essais locaux.

   CODE est le code du site dans GoatCounter (https://CODE.goatcounter.com). Vide : aucune
   mesure. stats-count.js est le script count.js de GoatCounter, copié tel quel le
   2026-11-23 depuis https://gc.zgo.at/count.js (licence ISC) pour ne pas dépendre d'un
   script tiers chargé à chaque visite. */
(function () {
  'use strict';
  var CODE = '';
  var HOST = 'bottin.rsn.quebec';

  // Les pages appellent rsnStats.view() sans se soucier de savoir si la mesure est active.
  window.rsnStats = { view: function () {} };
  if (!CODE || location.hostname !== HOST) return;
  if (/[?&]token=/i.test(location.search)) return;

  function clean(p) { return String(p || '/').split('#')[0].split('?')[0] || '/'; }

  // Chemin compté au chargement : celui de l'adresse canonique (comme le fait GoatCounter),
  // sinon celui de la page.
  var last = (function () {
    try {
      var c = document.querySelector('link[rel="canonical"][href]');
      if (c) { var u = new URL(c.href, location.href); if (u.hostname === location.hostname) return clean(u.pathname); }
    } catch (e) {}
    return clean(location.pathname);
  })();

  window.goatcounter = {
    no_events: true,
    path: function (p) { return clean(p); },
    referrer: function (r) {
      try { return r && new URL(r).hostname !== location.hostname ? r : ''; } catch (e) { return ''; }
    }
  };

  var s = document.createElement('script');
  s.async = true;
  s.src = '/stats-count.js';
  s.setAttribute('data-goatcounter', 'https://' + CODE + '.goatcounter.com/count');
  document.head.appendChild(s);

  // Une fiche ouverte depuis l'accueil ne recharge pas la page : elle est comptée ici comme
  // une vue de /membre/<slug>, sans provenance (celle-ci est déjà comptée à l'arrivée).
  window.rsnStats.view = function (path, title) {
    path = clean(path);
    if (path === last) return;
    last = path;
    if (window.goatcounter && typeof window.goatcounter.count === 'function') {
      window.goatcounter.count({ path: path, title: title || document.title, referrer: '' });
    }
  };
})();
