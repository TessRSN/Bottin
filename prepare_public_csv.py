#!/usr/bin/env python3
"""
=============================================================
  RSN — Préparation du CSV public pour le bottin en ligne
=============================================================

Ce script prend le CSV complet des membres (all_members.csv)
et génère un CSV public sécurisé (public_members.csv) :

  - Membres "Oui"     → données réelles, affichées normalement
  - Membres ""  (vide) → nom réel conservé, données personnelles
                         remplacées par du placeholder, mais les
                         champs structurels (type, axes, etc.)
                         restent intacts pour les filtres/pastilles
  - Membres "Non"      → exclus du CSV public mais comptés dans
                         une ligne spéciale de statistiques agrégées

Usage :
  python3 prepare_public_csv.py
  python3 prepare_public_csv.py chemin/vers/mon_fichier.csv
  python3 prepare_public_csv.py all_members.csv public_members.csv

Le script détecte automatiquement l'encodage (UTF-8 ou Latin-1).
"""

import csv
import sys
import os

# ─── CONFIGURATION ───────────────────────────────────────────

# Colonnes du CSV (doivent correspondre aux headers du fichier)
COL_PRENOM = 'Prénom'
COL_NOM = 'Nom de la famille'
COL_EMAIL = 'E-mail / Courriel'
COL_EMAIL2 = 'Autre courriel'
COL_STATUT = 'Statut actuel'
COL_INSTITUTION = 'Institution / organisation 1'
COL_TYPE = "Type d'adhesion"
COL_CONSENT = 'Autorisez-vous le RSN à vous créer un profil de membre public'

# ─── COLONNES SENSIBLES (remplacées par du placeholder) ──────
# Ce sont les données personnelles qu'on ne veut pas exposer.
# On NE touche PAS aux champs structurels (type d'adhésion, axes,
# principes, champs d'action, consent) car ils alimentent les
# filtres et les pastilles dans le UI.
COLS_SENSITIVE = [
    COL_EMAIL,
    COL_EMAIL2,
    COL_STATUT,
    COL_INSTITUTION,
    'Réseau 1',
    'Expertise',
    "Thèmes d'intérêt",
    'Projet de recherche',
    'Étudiant.e.s',
    'Référée par',
    'Droit de vote',
    'ORCID',
    'CV / LinkedIn',
    'Évaluateur du RSN - nouv. formulaire',
]

# Valeurs de remplacement pour les colonnes sensibles
PLACEHOLDER = {
    COL_EMAIL: 'membre@rsn-placeholder.ca',
    COL_INSTITUTION: 'Institution non divulguée',
    COL_STATUT: 'Non divulgué',
}

# Ligne spéciale pour stocker les stats des membres exclus ("Non")
STATS_ROW_MARKER = '__STATS_EXCLUDED__'


def detect_encoding(filepath):
    """Détecte si le fichier est UTF-8 ou Latin-1."""
    with open(filepath, 'rb') as f:
        raw = f.read(500)
    try:
        raw.decode('utf-8')
        return 'utf-8'
    except UnicodeDecodeError:
        return 'iso-8859-1'


def read_csv(filepath):
    """Lit le CSV avec détection automatique d'encodage."""
    enc = detect_encoding(filepath)
    print(f"  Encodage détecté : {enc}")
    with open(filepath, encoding=enc, newline='') as f:
        reader = csv.DictReader(f)
        headers = [h.strip() for h in reader.fieldnames]
        # Re-read with stripped headers
        f.seek(0)
        reader = csv.DictReader(f)
        rows = []
        for row in reader:
            cleaned = {}
            for k, v in row.items():
                cleaned[k.strip()] = (v or '').strip()
            rows.append(cleaned)
    return headers, rows


def prepare_public_csv(input_path, output_path):
    """Génère le CSV public à partir du CSV complet."""
    print(f"\n{'='*60}")
    print(f"  RSN — Préparation du CSV public")
    print(f"{'='*60}")
    print(f"\n  Fichier source : {input_path}")

    headers, rows = read_csv(input_path)
    print(f"  Membres total  : {len(rows)}")

    # Verify critical columns exist
    for col in [COL_PRENOM, COL_NOM, COL_CONSENT]:
        if col not in headers:
            print(f"\n  ERREUR : Colonne '{col}' introuvable !")
            print(f"  Colonnes disponibles : {headers}")
            sys.exit(1)

    # Categorize members
    public_rows = []      # consent = Oui → données réelles
    pending_rows = []     # consent = '' → nom réel + données sensibles masquées
    excluded_stats = {    # consent = Non → stats seulement
        'total': 0,
        'regulier': 0,
        'etudiant': 0,
        'partenaire': 0
    }

    for row in rows:
        # Ignorer les lignes vides (sans prénom ni nom)
        if not row.get(COL_PRENOM, '').strip() and not row.get(COL_NOM, '').strip():
            continue
        consent = row.get(COL_CONSENT, '').strip().lower()
        type_adh = row.get(COL_TYPE, '').strip().lower()

        if consent.startswith('oui'):
            # ✓ Consenti → toutes les données réelles
            public_rows.append(row)

        elif consent.startswith('non'):
            # ✗ Refusé → exclu du CSV, stats agrégées seulement
            excluded_stats['total'] += 1
            if 'régulier' in type_adh or 'regulier' in type_adh:
                excluded_stats['regulier'] += 1
            elif 'étudiant' in type_adh or 'etudiant' in type_adh:
                excluded_stats['etudiant'] += 1
            elif 'partenaire' in type_adh:
                excluded_stats['partenaire'] += 1

        else:
            # ⏳ En attente → masquer SEULEMENT les données personnelles
            # On garde intacts : prénom, nom, type d'adhésion, axes,
            # principes, champs d'action, consent (vide) — pour que
            # les filtres et pastilles fonctionnent dans le UI
            masked = dict(row)
            for col in COLS_SENSITIVE:
                if col in masked:
                    masked[col] = PLACEHOLDER.get(col, '')
            pending_rows.append(masked)

    # Create stats row (invisible member that carries excluded counts)
    stats_row = {h: '' for h in headers}
    stats_row[COL_PRENOM] = STATS_ROW_MARKER
    stats_row[COL_NOM] = ''
    stats_row[COL_EMAIL] = (
        f"{excluded_stats['total']},"
        f"{excluded_stats['regulier']},"
        f"{excluded_stats['etudiant']},"
        f"{excluded_stats['partenaire']}"
    )
    stats_row[COL_CONSENT] = 'stats'

    # Combine and write
    all_public = public_rows + pending_rows + [stats_row]

    with open(output_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(all_public)

    # ─── Résumé ───
    pending_with_form = sum(
        1 for r in pending_rows if r.get("1e Axe d'intérêt", '').strip()
    )
    pending_without_form = len(pending_rows) - pending_with_form

    print(f"\n  Résultat :")
    print(f"    ✓ Membres publics (Oui)              : {len(public_rows)}")
    print(f"    ⏳ En attente — formulaire rempli      : {pending_with_form}")
    print(f"    ⏳ En attente — formulaire NON rempli  : {pending_without_form}")
    print(f"    ✗ Membres exclus (Non)                : {excluded_stats['total']}")
    print(f"      (stats agrégées dans une ligne spéciale)")
    print(f"\n  Champs masqués pour les {len(pending_rows)} membres en attente :")
    print(f"    email, statut, institution, réseau, expertise,")
    print(f"    thèmes, projet, étudiants, référent, ORCID, CV")
    print(f"  Champs CONSERVÉS (pour filtres & pastilles) :")
    print(f"    prénom, nom, type d'adhésion, axes d'intérêt,")
    print(f"    principes fondateurs, champs d'action, consent")
    print(f"\n  Fichier généré : {output_path}")
    print(f"  Taille : {os.path.getsize(output_path) / 1024:.1f} Ko")
    print(f"\n  Ce fichier est prêt à être publié sur GitHub/Netlify.")
    print(f"  ⚠ Ne publiez JAMAIS le fichier source ({os.path.basename(input_path)}) !")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    # Default paths
    script_dir = os.path.dirname(os.path.abspath(__file__))
    default_input = os.path.join(script_dir, 'all_members.csv')
    default_output = os.path.join(script_dir, 'public_members.csv')

    if len(sys.argv) >= 3:
        input_path = sys.argv[1]
        output_path = sys.argv[2]
    elif len(sys.argv) == 2:
        input_path = sys.argv[1]
        output_path = default_output
    else:
        input_path = default_input
        output_path = default_output

    if not os.path.exists(input_path):
        print(f"Erreur : fichier introuvable → {input_path}")
        sys.exit(1)

    prepare_public_csv(input_path, output_path)
