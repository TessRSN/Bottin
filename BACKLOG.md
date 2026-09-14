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
- **À faire au moment de fusionner `connexions` dans `main`** (pas avant, sinon la prod lit une propriété inexistante) : renommer la propriété Notion « Thèmes d'intérêt » → « Thèmes de recherche ou d'intérêt » et mettre à jour `PROP.themes` (lib/notion.js), `CSV_COL.themes` et `CONFIG.COL.themes` (index.html) dans le même déploiement.
- Supprimer la propriété Notion « Expertise » (vide) et l'option « Incertain·e pour le moment » du select « Évaluateur » (sans fiche) — à la main dans Notion, quand `main` ne les lit plus.
- **Au moment de la fusion dans `main`, aussi** : (a) renommer la propriété Notion « Projet de recherche » → « Présentation » et mettre à jour `PROP.projet`, `CSV_COL.projet`, `CONFIG.COL.projet` ; (b) migrer les 34 fiches « Coordination ou gestion d'équipe » vers « Personne en coordination ou gestion de la recherche » (nouveau libellé du 2026-09-14) puis retirer l'ancien libellé de `STATUT_OPTIONS` (api/membership-report.js) et du select Notion. D'ici là, la page de modification présélectionne le nouveau libellé pour l'ancien.
- 293 fiches approuvées sans statut, 430 sans consentement, ~300 sans axes : à combler par la campagne de renouvellement et de re-consentement.

## Édition profil

- ~~Ajouter dans `edit.html` un bloc consentement équivalent à celui de `join.html`~~ — fait le 2026-09-14 (branche `connexions`).

## Institutions

- 10 institutions créées le 11 mai 2026 sont en statut "En attente" dans Notion. À enrichir manuellement (adresses, statut "Validée") :
  - Alvina N. Services Conseils Inc., CCSMTL, CIUSSS-ODIM et Centre de recherche Douglas, DMFMU Université de Montréal, Ministère de l'Économie de l'Innovation et de l'Énergie, Mount Kenya University, Netiv Institute / McGill University, Santé Canada, Université Laval faculté des sciences infirmières, Université Nazi Boni.

## Sécurité

- Régénérer périodiquement le `NOTION_KEY` (Settings → Integrations → "RSN Bottin" → Refresh secret).
