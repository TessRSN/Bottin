# Vue Connexions — graphe de proximité entre membres

**Date** : 2026-05-04
**Branche** : `connexions`
**Statut** : brainstorming en cours

## Contexte

Le bottin actuel propose 3 vues (Profils, Tableau, Carte) + filtres + recherche
améliorée Fuse.js. Aujourd'hui rien ne montre les **connexions implicites** entre
membres : qui partage des intérêts ou des thématiques avec qui.

Tess voit deux usages :

- **A1 — Membres actif·ves** : trouver des collaborateur·rices potentiels (gens
  proches en intérêts scientifiques).
- **A3 — Admin (Tess)** : identifier des duos potentiels à mettre en relation.

## Décisions actées

- **Approche choisie** : Option N2 — page dédiée « Connexions » avec graphe
  force-directed inspiré d'Obsidian.
- **Calcul de similarité** : option B2 — catégories structurées (axes / principes /
  champs) + mots-clés des champs libres (expertise, thèmes, projet). Pondération
  forte sur les champs libres puisque les catégories sont historiquement
  sur-renseignées (héritage du formulaire précédent).
- **Bibliothèque graphe** : vis.js Network (open source MIT, gratuit, force-directed
  natif, scale jusqu'à plusieurs milliers de nœuds).
- **Pas de SaaS payant** ni d'infrastructure additionnelle.

(Détails à étoffer au fur et à mesure du brainstorming.)
