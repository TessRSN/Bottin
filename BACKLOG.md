# Backlog — Bottin RSN

Liste des chantiers à venir, ordre indicatif. À éditer librement.

## SEO / Référencement

- **Google Search Console** : ajouter la propriété `https://bottin.rsn.quebec/`, vérifier via meta tag dans le `<head>` de `index.html`, soumettre `sitemap.xml`.
  - **Objectif** : permettre aux chercheur·euse·s du RSN d'être référencé·e·s individuellement via une recherche Google ("Nom Prénom RSN santé numérique" par ex).
  - Prérequis : avoir un `sitemap.xml` qui liste les profils publics, et probablement des pages dédiées par membre (actuellement le bottin est une SPA — chaque membre n'a pas d'URL propre).
  - Implique probablement : structurer des URLs canoniques par membre (`/profil/{slug}` ou `?m={slug}`), avec un rendu minimal côté serverless (SSR partiel pour les bots) ou un pre-rendering au build.
  - Voir aussi : Schema.org / JSON-LD pour enrichir les résultats Google (Person + Organization).

## Vue Connexions / Profils proches

- Branche `connexions` : actuellement en développement. Finalise et merge dans `main` quand prête.
- Idée : enrichir le pont FR↔EN avec MeSH bilingue pour les termes médicaux spécialisés (au-delà des ~250 paires manuelles actuelles).

## Conformité Loi 25

- Page `confidentialite.html` publique listant : données collectées, finalités, durées de conservation, mécanismes de retrait, coordonnées du RPRP.
- Désigner formellement un Responsable de la Protection des Renseignements Personnels (RPRP) et publier son nom + courriel.
- Documenter le registre des incidents de confidentialité (interne).

## Données membres (unification, 2026-09-14)

- **Fait dans Notion le 2026-09-14** : l'ancien champ « Expertise » (47 fiches) a été fusionné dans « Thèmes d'intérêt » (sauvegarde hors dépôt), et les 10 « Incertain·e pour le moment » normalisés en « Incertain ». La branche `connexions` ne lit ni n'écrit plus « Expertise ».
- **Fait à la fusion de `connexions` dans `main`, le 2026-09-15** : propriétés Notion renommées « Thèmes d'intérêt » → « Thèmes de recherche ou d'intérêt » et « Projet de recherche » → « Présentation » (`PROP`, `CSV_COL`, `CONFIG.COL` mis à jour dans le même déploiement) ; propriété « Expertise » supprimée ; option « Incertain·e pour le moment » retirée du select « Évaluateur » ; 34 fiches « Coordination ou gestion d'équipe » migrées vers « Personne en coordination ou gestion de la recherche », ancien libellé retiré de `STATUT_OPTIONS` et du select Notion (la page de modification garde une correspondance de sécurité pour l'ancien).
- 293 fiches approuvées sans statut, 430 sans consentement, ~300 sans axes : à combler par la campagne de renouvellement et de re-consentement.
- **Fait dans Notion le 2026-09-15** : les axes, principes fondateurs et champs d'action des 379 fiches portant la signature des imports (tout coché : 4/5/3, ou 4/5/0) ont été vidés — personne n'avait fait ces choix. Sauvegarde hors dépôt (`Downloads/backup-axes-principes-champs-2026-09-15.json`). Le bottin affiche et filtre désormais toutes les sélections d'un membre, plus seulement la première. Les membres concernés choisiront à leur prochaine modification de profil (axes obligatoires) ou lors de la campagne de renouvellement.
- **Créée dans Notion le 2026-09-14** : propriété technique « OpenAlex ID » (texte) — fiche auteur OpenAlex choisie par la personne dans les formulaires (recherche par nom, sans ORCID) pour les suggestions de thèmes. Jamais affichée ni exportée dans le bottin ; présente dans les sauvegardes. Pourra servir plus tard à lister les publications.

## Édition profil

- ~~Ajouter dans `edit.html` un bloc consentement équivalent à celui de `join.html`~~ — fait le 2026-09-14 (branche `connexions`).

## Institutions

- 10 institutions créées le 11 mai 2026 sont en statut "En attente" dans Notion. À enrichir manuellement (adresses, statut "Validée") :
  - Alvina N. Services Conseils Inc., CCSMTL, CIUSSS-ODIM et Centre de recherche Douglas, DMFMU Université de Montréal, Ministère de l'Économie de l'Innovation et de l'Énergie, Mount Kenya University, Netiv Institute / McGill University, Santé Canada, Université Laval faculté des sciences infirmières, Université Nazi Boni.

## Sécurité

- Régénérer périodiquement le `NOTION_KEY` (Settings → Integrations → "RSN Bottin" → Refresh secret).
