# Bottin des membres — RSN (Réseau de santé numérique)

**[Accéder au bottin en ligne](https://bottin-gamma.vercel.app/)**

Carte interactive et répertoire des membres du RSN. Les données sont stockées dans une base Notion et servies via une API Vercel. Les membres peuvent modifier leur profil via un magic link (vérification par email, sans mot de passe).

## Architecture

```
Vercel (héberge tout)
├── index.html              ← Page web du bottin (carte + profils + tableau + filtres)
├── magic-link.html         ← Page "entrez votre email" pour modifier son profil
├── edit.html               ← Formulaire de modification pré-rempli (bilingue)
├── api/
│   ├── magic-link.js       ← Vérifie l'email dans Notion, envoie un lien sécurisé
│   ├── profile.js          ← GET/POST pour lire/modifier un profil
│   └── export.js           ← Exporte Notion → CSV (cron quotidien + temps réel)
├── lib/
│   ├── notion.js           ← Client Notion API + mapping des colonnes
│   ├── token.js            ← JWT sign/verify (magic links, 1h d'expiration)
│   └── email.js            ← Envoi d'emails via Resend
└── vercel.json             ← Configuration cron + rewrites

Notion (base de données)
└── Membres RSN             ← Source de vérité, vue Kanban pour approbation

GitHub (code source)
└── TessRSN/Bottin          ← Ce repo, pour partage et documentation
```

## Flux de modification de profil

1. Le membre clique "Mettre à jour mon profil" sur le bottin
2. Entre son courriel institutionnel
3. Reçoit un email avec un lien sécurisé (valide 1h)
4. Accède à un formulaire pré-rempli avec ses données actuelles
5. Modifie uniquement ce qu'il veut
6. Les modifications apparaissent dans Notion (statut "Modifié")
7. L'admin approuve dans le Kanban Notion → les données sont mises à jour sur le bottin

## Règles de consentement

- **"Oui"** → le membre apparaît avec toutes ses données
- **Vide** → le nom est conservé, les données personnelles sont masquées, les champs structurels (type, axes, etc.) restent pour les filtres
- **"Non"** → le membre est exclu du bottin mais comptabilisé dans les statistiques agrégées

## Fonctionnalités du bottin

- **Carte Leaflet** avec regroupement de marqueurs et profils cliquables
- **Vue profils** avec fiches détaillées
- **Vue tableau** triable par colonnes
- **4 filtres multi-sélection** : type d'adhésion, axes d'intérêt, principes fondateurs, champs d'action
- **Barre de recherche** par nom, institution, courriel ou expertise
- **Mode sombre / clair**
- **Bilingue** français / anglais
- **Magic links** pour modification de profil sans mot de passe
- **Persistance de l'état** : vue, recherche, filtres conservés au rafraîchissement (via URL hash)

## Variables d'environnement (Vercel)

| Variable | Description |
|----------|-------------|
| `NOTION_KEY` | Clé API Notion (intégration "RSN Bottin API") |
| `NOTION_DB_ID` | ID de la base de données Notion |
| `RESEND_KEY` | Clé API Resend (envoi d'emails) |
| `JWT_SECRET` | Secret pour signer les magic links |

## Reproduire ce projet

1. Créer une base de données Notion avec les propriétés documentées dans `lib/notion.js`
2. Créer une intégration Notion et la connecter à la base
3. Créer un compte Resend et vérifier un domaine d'envoi
4. Déployer sur Vercel avec les variables d'environnement
5. Configurer le cron dans `vercel.json` pour l'export quotidien
