# Toggle courriel public dans le bottin

**Date** : 2026-05-04
**Auteur** : Tess + Claude
**Statut** : Phase 2f, prête à implémenter

## Contexte

Aujourd'hui le bottin RSN fonctionne avec un consentement binaire :
- `consent = Oui` → tout le profil est visible (incluant les emails)
- `consent = Non` → profil invisible
- `consent = vide` → profil bloqué/flouté en attente

Deux problèmes identifiés :
- **Anti-spam** : les emails des membres sont scrapés par des bots (cible D).
- **Réticents** : certaines personnes hésitent à s'inscrire au bottin parce qu'elles
  ne veulent pas que **leur courriel** soit public, même si elles acceptent que
  le reste de leur profil le soit (cible A).

## Objectif

Ajouter une granularité **minimale et ciblée** sur le seul champ qui pose
problème (courriel principal) sans surcharger l'UX du formulaire.

Décisions actées :
- **Un seul nouveau toggle** : « Afficher mon courriel principal dans le bottin ».
- **Pas de toggle** sur les autres champs : CV/LinkedIn, ORCID, projet,
  réseau, etc. — ces champs sont par nature publics ou de portée pro
  (URLs académiques, profils LinkedIn, etc.).
- **Email secondaire** : jamais affiché publiquement (statu quo confirmé,
  c'est un canal de contact admin uniquement).
- **Champ Étudiants** : retiré de l'affichage public (3% de membres l'ont rempli,
  pas pertinent dans le bottin). Conservé dans Notion pour usage interne.
- Le **consentement global** ne change pas : reste un Oui/Non/vide qui décide
  si le profil global est publié dans le bottin.

## Périmètre

### En scope

1. Nouveau champ Notion **« Afficher courriel »** (checkbox) sur la base Membres.
2. Toggle visible dans `join.html` (à côté du champ courriel principal),
   par défaut **coché**.
3. Toggle visible dans `edit.html` (idem).
4. Côté `api/profile.js` : accepter le nouveau champ comme éditable.
5. Côté `api/join.js` : créer le membre avec la valeur du toggle.
6. Côté `lib/notion.js` : `getProfile`, `updateProfile`, `createMember`,
   `getAllMembers` lisent/écrivent le nouveau champ.
7. Côté `index.html` (bottin) : cacher l'email principal si
   `Afficher courriel = false`. Retirer l'affichage du champ Étudiants
   des cards et de la modal. Toujours masquer email secondaire.
8. Côté `api/export.js` : adapter le CSV public pour respecter le toggle
   (remplacer email par chaîne vide ou `Non divulgué` selon le pattern
   actuel pour les non-consents).
9. **Migration** : pour les 210 membres actuels avec `consent = Oui`,
   set `Afficher courriel = true` automatiquement (statu quo : ils sont déjà
   visibles, donc on ne change rien à leur situation).

### Hors scope

- Toggle sur d'autres champs (CV, projet, étudiants, etc.).
- Refonte du consentement global.
- Système de notification quand un membre change son toggle.
- Texte de consentement / information juridique sur la conservation des données
  (l'existant suffit, le système de renouvellement 2 ans + emails 60j/30j est
  déjà en place).

## Détails techniques

### Notion

- **Nom du champ** : `Afficher courriel` (en français pour cohérence avec les
  autres champs Notion).
- **Type** : checkbox
- **Default** : la propriété sera créée par Tess manuellement dans Notion
  (étape coordonnée). Pour les fiches existantes, la valeur sera initialement
  `false` (Notion default), puis migrée à `true` pour les `consent = Oui`
  via un endpoint dédié.

### lib/notion.js

Ajouter dans `PROP` :
```js
afficherCourriel: 'Afficher courriel', // checkbox
```

Modifier :
- `getProfile(pageId)` : retourner `afficherCourriel: getText(p[PROP.afficherCourriel])`
- `updateProfile(pageId, data)` :
  ```js
  if (data.afficherCourriel !== undefined) {
    properties[PROP.afficherCourriel] = { checkbox: !!data.afficherCourriel };
  }
  ```
- `createMember(data)` :
  ```js
  if (data.afficherCourriel !== undefined) {
    properties[PROP.afficherCourriel] = { checkbox: !!data.afficherCourriel };
  }
  ```
- `getAllMembers()` : ajouter `afficherCourriel: getText(p[PROP.afficherCourriel]) === true`

### api/profile.js

Ajouter `afficherCourriel` à `EDITABLE_FIELDS`.

### api/join.js

Lire `body.afficherCourriel` (default `true` si non fourni) et passer à `createMember`.

### api/export.js

Modifier la génération du CSV pour appliquer le toggle :
- Si `afficherCourriel === false`, remplacer le champ `Email` par chaîne vide
  (ou `Non divulgué` selon le pattern existant pour les non-consents).
- L'email secondaire (`Autre courriel`) est toujours masqué dans l'export public
  (déjà le cas via la logique anonymisation actuelle, à confirmer).

### join.html

Sous le champ courriel principal :
```html
<div class="field">
  <label class="field-label" id="l_email">Courriel<span class="required-mark">*</span></label>
  <input id="f_email" type="email" required>
  <label class="checkbox-inline">
    <input type="checkbox" id="f_afficher_courriel" checked>
    <span data-i18n="afficher_courriel_label">
      Afficher mon courriel dans le bottin public
    </span>
  </label>
  <div class="field-hint" id="h_afficher_courriel" data-i18n="afficher_courriel_hint">
    Décochez pour limiter le partage de votre adresse aux administrateurs du RSN.
  </div>
</div>
```

i18n FR + EN à ajouter.

### edit.html

Même bloc, dans la section Identité, sous le courriel principal.
Précharger la valeur depuis `profile.afficherCourriel`.

### index.html (bottin)

1. **Email principal** : afficher uniquement si `m.afficherCourriel === true`.
   Sinon, **ne rien afficher** dans la card / modal (pas de mention « non
   divulgué » pour ne pas alourdir l'UI ; le toggle est implicite).
2. **Email secondaire** : ne jamais afficher (déjà le cas).
3. **Champ Étudiants** : retirer les blocs `if (m.etudiants)` des fonctions
   de rendu card et modal. Le champ reste dans `loadMembers` (lecture CSV)
   et la vue tableau (qui est aussi publique — à retirer du tableau aussi
   pour cohérence). Conservé uniquement dans Notion pour usage admin.

### Migration

Endpoint admin **`mode=migrate-afficher-courriel`** dans `api/membership-report.js` :
- Pour chaque membre avec `consent === 'Oui'`, set `Afficher courriel = true`.
- Idempotent (skip si déjà `true`).
- Dry-run + apply comme les autres modes.

## Tests attendus

### Côté front
- Nouveau membre via `join.html` qui décoche le toggle → email caché dans le bottin.
- Membre existant qui édite son profil via `edit.html` → toggle préchargé,
  modification persistée.
- Bottin (`index.html`) : un membre avec `afficher_courriel = false` n'a pas
  son email visible dans card / modal.
- Email secondaire : invisible quel que soit le toggle.
- Champ Étudiants : invisible dans le bottin.

### Côté back
- `getAllMembers` retourne bien le bool.
- `updateProfile` accepte la valeur.
- Migration idempotente : rerun = no-op.
- Export CSV public respecte le toggle.

### Migration
- Avant : 210 membres `consent=Oui`, tous avec email visible dans le bottin.
- Après migration : tous ont `Afficher courriel = true`, statu quo visuel.
- Aucun email envoyé pendant la migration (vérifié : `pages.update` sur
  checkbox ne déclenche aucun hook email).

## Plan de déploiement

1. Tess crée la propriété `Afficher courriel` (checkbox) dans la base Notion.
2. Code modifié et déployé en une fois (lib + api + html + migration endpoint).
3. Tess lance le dry-run de migration (vérifie le nombre de fiches concernées).
4. Tess lance l'apply (210 membres mis à jour en `Afficher courriel = true`).
5. Test bout en bout : Tess édite son profil, décoche, vérifie que son email
   disparaît du bottin.
6. Re-cocher pour rétablir.
