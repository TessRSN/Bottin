# Bottin des membres — RSN (Réseau de santé numérique)

Carte interactive et répertoire des membres du RSN. Le projet se compose de trois éléments : un script de conversion Excel → CSV, un script de préparation des données publiques, et une page HTML autonome qui affiche la carte et le bottin.

## Structure du projet

```
carto_membres/
├── RSN_BD_AllMembers.xlsx   ← Base de données Excel (source principale)
├── excel_to_csv.py          ← Script 1 : Excel → CSV (préserve les hyperliens)
├── all_members.csv          ← CSV complet généré par le script 1
├── prepare_public_csv.py    ← Script 2 : CSV complet → CSV public (gère le consentement)
├── public_members.csv       ← CSV public généré par le script 2
├── index.html               ← Page web du bottin (carte + tableau + filtres)
├── L_RSN_FR_RGB (3).png     ← Logo RSN utilisé dans le header
└── README.md
```

## Prérequis

- Python 3
- La librairie `openpyxl` (pour lire les fichiers Excel)

```bash
pip3 install openpyxl
```

## Comment mettre à jour le bottin

Quand la base de données Excel est modifiée, il suffit de relancer les deux scripts dans l'ordre :

### Étape 1 — Convertir le Excel en CSV

```bash
python3 excel_to_csv.py RSN_BD_AllMembers.xlsx all_members.csv
```

Ce script lit la feuille **"ALL (new)"** du fichier Excel et génère `all_members.csv`. Les hyperliens (ORCID, CV/LinkedIn, emails) sont automatiquement convertis en URLs textuelles pour ne pas les perdre.

Pour cibler une autre feuille :

```bash
python3 excel_to_csv.py RSN_BD_AllMembers.xlsx all_members.csv "Nom de la feuille"
```

### Étape 2 — Générer le CSV public

```bash
python3 prepare_public_csv.py all_members.csv public_members.csv
```

Ce script applique les règles de consentement :

- **"Oui"** → le membre apparaît avec toutes ses données
- **Vide** → le nom est conservé, les données personnelles sont masquées, les champs structurels (type, axes, etc.) restent pour les filtres
- **"Non"** → le membre est exclu du CSV public mais comptabilisé dans les statistiques agrégées

### Étape 3 — Ouvrir le bottin

Ouvrir `index.html` dans un navigateur. La page charge `public_members.csv` automatiquement.

## Commande rapide (tout d'un coup)

```bash
python3 excel_to_csv.py RSN_BD_AllMembers.xlsx all_members.csv && python3 prepare_public_csv.py all_members.csv public_members.csv
```

## Fonctionnalités du bottin (index.html)

- **Carte Leaflet** avec regroupement de marqueurs (clusters)
- **Vue tableau** triable par colonnes
- **4 filtres multi-sélection** : type d'adhésion, axes d'intérêt, principes fondateurs, champs d'action
- **Barre de recherche** par nom, institution, courriel ou expertise
- **Mode sombre / clair**
- **Bilingue** français / anglais
- **Liens cliquables** vers ORCID et CV/LinkedIn (ouvrent un nouvel onglet)
- **Badges** pour le consentement en attente et les formulaires incomplets
- **Export CSV** des résultats filtrés
- **Pagination** configurable
