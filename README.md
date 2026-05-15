# Bottin des membres — RSN (Réseau de santé numérique)

**[Accéder au bottin en ligne](https://bottin.rsn.quebec/)**

Carte interactive et répertoire des membres du Réseau de santé numérique (RSN). Les données sont stockées dans une base Notion et servies via une API Vercel. Les membres peuvent modifier leur profil via un magic link (vérification par email, sans mot de passe).

## Architecture

```
Vercel (héberge tout)
├── index.html              ← Bottin interactif (carte + profils + tableau)
├── magic-link.html         ← Page d'entrée du courriel pour modifier son profil
├── edit.html               ← Formulaire de modification pré-rempli (bilingue)
├── logo-rsn.png            ← Logo RSN
├── api/
│   ├── magic-link.js       ← Vérifie l'email dans Notion → envoie un lien sécurisé
│   ├── profile.js          ← GET/POST pour lire/modifier un profil membre
│   └── export.js           ← Exporte Notion → CSV avec règles de consentement
├── lib/
│   ├── notion.js           ← Client Notion API + mapping des colonnes
│   ├── token.js            ← JWT sign/verify (magic links, 1h d'expiration)
│   └── email.js            ← Envoi d'emails via Gmail SMTP (Nodemailer)
├── join/index.html         ← Redirection vers le formulaire d'adhésion
├── update/index.html       ← Redirection vers la page magic link
└── vercel.json             ← Configuration cron + headers

Notion (base de données)
└── Membres RSN             ← Source de vérité, vue Kanban pour approbation

GitHub (code source)
└── TessRSN/Bottin          ← Ce repo, pour partage et documentation
```

## Comment ça marche

### Nouveau membre
1. Clique "Devenir membre" sur le bottin
2. Remplit le formulaire d'inscription
3. L'admin voit la demande dans le Kanban Notion → approuve ou refuse
4. Le membre apparaît sur le bottin après approbation

### Modifier son profil (magic link)
1. Clique "Mettre à jour mon profil" sur le bottin
2. Entre son courriel institutionnel
3. Reçoit un email avec un lien sécurisé (valide 1h, sans mot de passe)
4. Accède à un formulaire pré-rempli avec ses données actuelles
5. Modifie uniquement ce qu'il veut (champs obligatoires : nom, email, institution, statut, axes, consentement)
6. Les modifications apparaissent dans Notion avec le statut "Modifié"
7. L'admin approuve dans le Kanban → les données sont mises à jour sur le bottin

### Export des données
- L'API `/api/export` interroge Notion en temps réel et génère un CSV
- Les règles de consentement sont appliquées automatiquement
- Le CSV est mis en cache 5 minutes sur le edge Vercel
- Un cron quotidien (6h UTC) rafraîchit le cache

## Règles de consentement

| Consentement | Données affichées | Données masquées |
|---|---|---|
| **Oui** | Toutes les données du profil | Aucune |
| **Vide** (en attente) | Nom + type d'adhésion + axes/principes/champs | Email, institution, statut, expertise, projet, ORCID, CV |
| **Non** | Aucune (exclu du bottin) | Tout — compté uniquement dans les statistiques agrégées |

## Fonctionnalités du bottin

- **Carte Leaflet** avec regroupement de marqueurs (clusters) et profils cliquables
- **Vue profils** avec fiches détaillées par membre
- **Vue tableau** triable par colonnes (nom, institution, type, etc.)
- **4 filtres multi-sélection** : type d'adhésion, région, statut, axes/principes/champs d'action
- **Barre de recherche** par nom, institution, courriel, expertise, thème ou projet
- **Mode sombre / clair** avec détection automatique des préférences système
- **Bilingue** français / anglais
- **Magic links** pour modification de profil sans mot de passe
- **Persistance de l'état** : vue, recherche, filtres et pagination conservés au rafraîchissement (via URL hash)
- **Badges** visuels pour le consentement en attente et les formulaires incomplets
- **Export CSV** des résultats filtrés

## Propriétés Notion

| Propriété | Type | Description |
|---|---|---|
| Prénom | Title | Prénom du membre |
| Nom | Rich text | Nom de famille |
| Email | Email | Courriel principal (utilisé pour les magic links) |
| Email secondaire | Email | Courriel alternatif |
| Institution | Rich text | Affiliation institutionnelle |
| Statut | Rich text | Poste / rôle actuel |
| Type d'adhésion | Select | Régulier, Étudiant, Partenaire |
| Axes d'intérêt | Multi-select | 4 axes thématiques du RSN |
| Principes fondateurs | Multi-select | 5 principes du RSN |
| Champs d'action | Multi-select | 3 champs d'action |
| Consentement | Select | Oui / Non / (vide = en attente) |
| Statut workflow | Select | Nouveau / Approuvé / Modifié / Refusé |
| + autres | Divers | Expertise, projet, ORCID, CV, etc. |

## Variables d'environnement (Vercel)

| Variable | Description |
|---|---|
| `NOTION_KEY` | Clé API de l'intégration Notion |
| `NOTION_DB_ID` | ID de la base de données Notion (32 caractères) |
| `GMAIL_USER` | Adresse Gmail pour l'envoi des magic links |
| `GMAIL_APP_PASSWORD` | Mot de passe d'application Gmail (16 caractères) |
| `JWT_SECRET` | Secret pour signer les tokens magic link |

## Reproduire ce projet

### Prérequis
- Un compte [Notion](https://notion.so) (gratuit)
- Un compte [Vercel](https://vercel.com) (gratuit, plan Hobby)
- Un compte Gmail avec authentification 2 facteurs activée
- Un repo GitHub

### Étapes
1. **Notion** : Créer une base de données avec les propriétés listées ci-dessus. Créer une [intégration](https://www.notion.so/my-integrations) et la connecter à la base.
2. **Gmail** : Activer la validation en 2 étapes, puis générer un [mot de passe d'application](https://myaccount.google.com/apppasswords).
3. **GitHub** : Forker ce repo ou copier les fichiers.
4. **Vercel** : Importer le repo GitHub, configurer les 5 variables d'environnement, déployer.
5. **Tester** : Visiter le bottin, demander un magic link, modifier un profil.

### Limites du plan gratuit
- **Vercel** : 100k requêtes/mois, fonctions serverless de 10s (30s max)
- **Notion API** : pas de limite documentée pour ce volume
- **Gmail SMTP** : 500 emails/jour

## Licence

Ce projet est partagé librement pour que d'autres réseaux de recherche puissent s'en inspirer.
