# Extension de l'édition de profil membre

**Date** : 2026-05-04
**Auteur** : Tess + Claude
**Statut** : Phase 1 en cours, Phase 2 en backlog

## Contexte et objectif

Aujourd'hui, `edit.html` (page accessible via magic link) permet aux membres de modifier
une partie de leur profil mais pas tout. Plusieurs cas d'usage sortent du champ
actuel :

- Quelqu'un qui passe d'étudiant à professeur ne peut pas changer son **type d'adhésion**
  (Étudiant → Régulier) ni son **statut FRQ** (Doctorat → Chercheur universitaire).
- Quelqu'un qui change d'institution ne peut pas mettre à jour ses **institutions** avec
  le même niveau de richesse que dans le formulaire d'inscription (autocomplete +
  ajout d'une nouvelle institution avec adresse).
- Quelqu'un qui change de courriel principal doit passer par l'admin (Tess) — peu
  scalable.

L'objectif est d'aligner complètement `edit.html` sur `join.html` côté champs et
ergonomie : tout ce qui est saisissable à l'inscription doit être modifiable à
l'édition.

## Périmètre

### En scope

1. **Champs à rendre éditables / cohérents avec `join.html`** :
   - `type` (Régulier / Étudiant / Partenaire) → radio, obligatoire
   - `statut` FRQ → radio sur 13 options, obligatoire
   - `institution` → multi-rangées avec autocomplete + ajout d'institution
     (avec adresse géocodée → entrée Notion en statut "En attente")
   - `email` (courriel principal) → éditable avec confirmation par magic link

2. **Préparation de la base** : les champs ci-dessus exigent que les données
   existantes soient propres (sinon, on aura des valeurs hors-liste qui cassent
   les radios). D'où **Phase 1 d'audit + nettoyage avant** d'ouvrir l'édition.

### Hors scope (pour l'instant)

- Fusion / division de profils
- Édition admin avec privilèges étendus
- Champs qui restent en lecture seule pour les membres (workflow,
  emailAccepteEnvoye, dates d'adhésion, etc.) — pilotés par les crons et l'admin.

## Phases

### Phase 1 — Audit + nettoyage (cette phase)

**But** : avoir une base où chaque valeur contrainte est dans le référentiel attendu,
pour que la Phase 2 puisse coder des radios sans gérer aucun edge case.

**Livrable 1 : endpoint d'audit** (`api/audit-fields.js`, à supprimer après usage)

Endpoint admin protégé par `ADMIN_KEY` qui parcourt tous les membres et liste les
anomalies pour chaque champ contraint. Format de retour : groupé par champ → par
valeur problématique → liste des membres concernés (id, nom, courriel).

Champs audités :

| Champ | Type Notion | Référentiel | Cas anomalie |
|---|---|---|---|
| `statut` | rich_text | 13 options FRQ (cf. `join.html` STATUS_OPTIONS) | valeur non listée |
| `type` | select | `['Régulier', 'Étudiant', 'Partenaire']` | valeur non listée OU vide |
| `institution` (texte) | rich_text | catalogue Institutions (split sur `;`) | morceau non trouvé |
| `axes` | multi_select | 4 axes FRQ | option orpheline |
| `principes` | multi_select | 5 principes | option orpheline |
| `champs` | multi_select | 3 champs | option orpheline |
| `consent` | select | `['Oui', 'Non', '']` | valeur non listée |
| `evaluateur` | rich_text | `['Oui', 'Non', '']` | valeur non listée (sera converti en select) |

Formats vérifiés (en plus) :

| Champ | Vérif |
|---|---|
| `email`, `email2` | contient `@`, pas d'espaces |
| `orcid` | URL valide ou format `XXXX-XXXX-XXXX-XXXX` |
| `cv` | URL valide |

**Livrable 2 : revue humaine**

Le rapport est partagé avec Tess. Pour chaque anomalie, décision :
- correction automatisable (faute de frappe, accent manquant, espace insécable…)
- correction manuelle (mapping ad hoc à décider cas par cas)

**Livrable 3 : scripts de correction ciblés**

Pour les corrections automatisables, on code un endpoint admin (un par lot) qui
applique les corrections en idempotent (skip si la valeur est déjà à jour). Tess
valide la liste avant exécution.

**Livrable 4 : conversions Notion**

Une fois la base propre :
- `statut` : conversion manuelle dans Notion de `rich_text` → `select` avec les
  13 options FRQ
- `evaluateur` : conversion manuelle de `rich_text` → `select` avec `Oui` / `Non`

Notion conserve les valeurs existantes au changement de type **si elles
matchent une option**. C'est pour ça que le nettoyage doit avoir lieu avant.

**Livrable 5 : MAJ `lib/notion.js`**

Adapter `getProfile`, `updateProfile`, `getAllMembers`, `createMember` pour
lire/écrire `statut` et `evaluateur` au format `select` au lieu de `rich_text`.

### Phase 2 — Refonte de `edit.html` (en backlog)

**Sous-phase 2a — Type, statut, institutions** :

- Champ `type` : 3 radios (Régulier / Étudiant / Partenaire), obligatoire.
  Backend : ajouter `type` à `EDITABLE_FIELDS` dans `api/profile.js`.
- Champ `statut` : 13 radios FRQ, obligatoire. (Le radio remplace le champ
  texte libre actuel.)
- Champ `institution` : multi-rangées avec autocomplete + ajout d'institution
  avec adresse, exactement comme `join.html`. Côté chargement, on utilise la
  Relation `Institution liée` (déjà migrée en Phase 2 précédente du projet)
  comme source de vérité — ça nous assure que les noms préremplis matchent
  toujours le catalogue. À la sauvegarde :
  - le champ texte `institution` est mis à jour (pour compat caches index.html)
  - la Relation est synchronisée
  - les nouvelles institutions sont géocodées et ajoutées à Notion en
    statut "En attente"

**Sous-phase 2b — Changement de courriel principal (P.C avec D.2)** :

Logique :

1. Dans `edit.html`, le champ courriel principal devient éditable.
2. Si la personne change la valeur et clique "Enregistrer" :
   - **Si elle a déjà un courriel secondaire** : on affiche un warning JS :
     « Ton ancien courriel principal X va remplacer ton secondaire Y. OK ? »
     Confirmer / Annuler.
   - On envoie un magic link de confirmation au **nouveau** courriel
     (`POST /api/request-email-change`).
3. La personne clique le lien dans son nouveau courriel.
4. Le serveur (`GET /api/confirm-email-change?token=xxx`) :
   - Lit le pageId, oldEmail, newEmail dans le token (HMAC signé, expiration courte).
   - Met à jour `email` = newEmail et `email2` = oldEmail.
   - Affiche une page de confirmation.

Composants ajoutés :
- Token type `email-change` dans `lib/token.js` (signEmailChangeToken / verifyEmailChangeToken)
- Endpoint `POST /api/request-email-change` (envoie le magic de confirmation)
- Endpoint `GET /api/confirm-email-change` (applique le changement)
- Template d'email dans `lib/email.js` (sendEmailChangeConfirmation)
- Page HTML de confirmation (`email-change-confirmed.html`) ou réutilisation de
  la page actuelle d'édition

Risques / mitigations :
- Quota Gmail SMTP : 500 destinataires/jour gratuit, ~1-2 changements/mois max
  attendus → quota négligeable.
- Magic link intercepté : avec P.C, l'attaquant·e doit avoir accès au courriel
  cible (sinon le changement ne s'applique pas). Plus sûr que P.D.
- Faute de frappe : si la personne tape mal son nouveau courriel, le lien arrive
  à un courriel inexistant ou pas le sien, le changement ne s'applique pas →
  son ancien courriel reste actif.

## Décisions actées (résumé)

- **Périmètre** : option C (les 3 champs alignés avec `join.html`) + ouverture du
  changement de courriel principal en P.C / D.2.
- **Approche** : Phase 1 (nettoyer la base) avant Phase 2 (refonte UI), pour
  éviter d'avoir à gérer des valeurs hors-liste dans le code.
- **Audit** : élargi à tous les champs avec valeurs contraintes + vérif des
  formats de courriel / ORCID / CV.
- **Statut + evaluateur** : à convertir en `select` dans Notion (pas seulement
  contraindre côté code).
- **Institutions au chargement** : utiliser la Relation `Institution liée`
  comme source de vérité (pas le champ texte) pour garantir un préremplissage
  matchant le catalogue.
- **Cas du courriel secondaire écrasé** : warning explicite avant l'envoi du
  magic link de confirmation.

## Tests attendus

### Phase 1
- [ ] Endpoint d'audit déployé et appelé avec succès.
- [ ] Rapport revu par Tess, listes de corrections validées.
- [ ] Scripts de correction exécutés en idempotent (rerun = no-op).
- [ ] `statut` et `evaluateur` convertis en `select` dans Notion.
- [ ] `lib/notion.js` mis à jour, tous les endpoints existants fonctionnent.
- [ ] Cron de retention fonctionne (lit les bonnes valeurs).
- [ ] Bottin (index.html) affiche les bonnes valeurs.

### Phase 2 (à finaliser quand on attaque)
- [ ] type / statut / institution éditables, validation côté front + back.
- [ ] Préremplissage institution via Relation marche.
- [ ] Ajout d'une nouvelle institution depuis edit fonctionne (création "En attente").
- [ ] Suppression d'une institution depuis edit retire la Relation.
- [ ] Changement de courriel envoie bien le magic de confirmation.
- [ ] Confirmation applique le swap (newEmail → principal, oldEmail → secondaire).
- [ ] Warning explicite avant écrasement d'un secondaire existant.

## Notes diverses

- Le formulaire `join.html` reste la référence visuelle et fonctionnelle :
  cohérence inscription ↔ édition.
- Les caches localStorage (`rsn-members-cache-v1`, `rsn-institutions-cache-v1`)
  doivent rester valides après les conversions de type Notion.
- Les scripts d'audit / correction suivent le pattern de
  `api/migrate-institutions-relation.js` (script jetable, supprimé après usage).
