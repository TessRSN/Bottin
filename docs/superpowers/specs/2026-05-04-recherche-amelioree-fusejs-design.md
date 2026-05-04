# Recherche améliorée du bottin (Fuse.js, FR + EN, fuzzy)

**Date** : 2026-05-04
**Auteur** : Tess + Claude
**Statut** : prêt à implémenter

## Contexte

La barre de recherche actuelle (`index.html`, ~ligne 1009) fait
`m._search.includes(query.toLowerCase())` sur la concat des champs textuels
du membre. Limites observées :

- Pas tolérante aux fautes (`epidemiologie` sans accent ne trouve pas
  `épidémiologie`).
- Pas de pondération : un match dans le nom n'a pas plus de poids qu'un
  match dans une thématique.
- Pas multilingue : la donnée Notion étant en français, un visiteur
  anglophone qui tape « PhD student » ne trouve rien.
- Pas de combinaison multi-mots avec AND : `machine learning McGill`
  cherche la sous-chaîne entière au lieu d'exiger les 3 mots.

L'objectif est de rendre la recherche **précise, tolérante et bilingue**
sans introduire d'infrastructure tierce (pas de SaaS payant à l'usage,
pas de service à héberger).

## Décisions actées

- **Bibliothèque** : Fuse.js (MIT, ~20 KB), chargée via CDN comme Leaflet.
- **Côté client uniquement** : pas d'API backend, pas d'index serveur.
  Pour 656 membres (ordre de grandeur du bottin RSN), Fuse en mémoire
  navigateur est largement suffisant.
- **Multilingue C2** : on indexe les versions FR + EN des champs structurés
  (statut, type d'adhésion). Les champs libres (expertise, thèmes, projet)
  restent indexés tels que remplis par le membre.
- **Multi-mots AND par défaut** : `motA motB motC` exige les 3 mots,
  chacun pouvant matcher n'importe quel champ.
- **Fuzzy threshold modéré** (Fuse `threshold: 0.3`) — permet petites
  fautes / variantes orthographiques sans dériver vers du bruit.
- **Insensible aux accents** : normalisation Unicode NFD + strip
  diacritics côté indexation **et** côté query.
- **Pas de highlight** des matches dans la card pour l'instant
  (peut-être plus tard).

## Périmètre

### En scope

1. Ajout de Fuse.js via CDN dans `index.html`.
2. Construction d'un index Fuse à chaque chargement de membres
   (`loadMembers` → après que `allMembers` est rempli).
3. Modification de `applyFilters()` pour utiliser Fuse quand la query est
   non vide. Quand vide, fallback sur l'ordre actuel.
4. Pondération par champ (cf. tableau ci-dessous).
5. Indexation FR + EN des champs structurés (statut, type) avec mapping
   dérivé des tables i18n existantes (cf. `STATUS_OPTIONS` /
   `MEMBERSHIP_OPTIONS` dans `join.html` et `edit.html` — à recopier ou
   référencer dans `index.html`).
6. Normalisation Unicode des deux côtés (index + query).
7. Compatibilité filtres existants (Type, Région, Statut, Focus) — la
   recherche **et** les filtres se combinent en AND.
8. Debounce de 150 ms sur l'input.
9. Message « 0 résultat » dédié.

### Hors scope

- Highlight visuel des matches dans la card (peut être ajouté plus tard).
- Recherche serveur / backend.
- Synonymes / vocabulaire contrôlé.
- Auto-complétion / suggestions de mots-clés.
- Recherche par phrase exacte avec guillemets (Fuse extended-search le
  permet, mais on ne l'expose pas comme syntaxe au début).

## Détails techniques

### Pondération des champs

| Champ Fuse | Source dans `m` | Poids |
|---|---|---|
| `name` | `m.prenom + ' ' + m.nom` | 4.0 |
| `email` | `m.email` | 0.5 |
| `institutions` | `m.institutions.join(' ')` | 3.5 |
| `statutFR` | `m.statut` | 2.0 |
| `statutEN` | mapping STATUS_OPTIONS | 2.0 |
| `typeFR` | `m.type` | 1.0 |
| `typeEN` | mapping MEMBERSHIP_OPTIONS | 1.0 |
| `expertise` | `m.expertise` | 4.0 |
| `themes` | `m.themes` | 4.0 |
| `projet` | `m.projet` | 4.0 |
| `axes` | `m.axes.join(' ')` | 1.5 |
| `principes` | `m.principes.join(' ')` | 1.5 |
| `champsAction` | `m.champsAction.join(' ')` | 1.5 |
| `reseau` | `m.reseau` | 0.5 |

Les chiffres sont des poids relatifs ; Fuse les normalise en interne.

### Configuration Fuse

```js
const fuseOptions = {
  includeScore: true,
  threshold: 0.3,
  ignoreLocation: true,        // match peut être n'importe où dans le champ
  useExtendedSearch: true,     // pour la combinaison multi-mots AND
  minMatchCharLength: 2,
  keys: [
    { name: 'name',          weight: 4.0 },
    { name: 'institutions',  weight: 3.5 },
    { name: 'expertise',     weight: 4.0 },
    { name: 'themes',        weight: 4.0 },
    { name: 'projet',        weight: 4.0 },
    { name: 'statutFR',      weight: 2.0 },
    { name: 'statutEN',      weight: 2.0 },
    { name: 'typeFR',        weight: 1.0 },
    { name: 'typeEN',        weight: 1.0 },
    { name: 'axes',          weight: 1.5 },
    { name: 'principes',     weight: 1.5 },
    { name: 'champsAction',  weight: 1.5 },
    { name: 'email',         weight: 0.5 },
    { name: 'reseau',        weight: 0.5 },
  ],
};
```

### Normalisation accents

Fonction utilitaire :

```js
function fold(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
```

Appliquée **avant** indexation sur chaque champ string ET sur la query
de recherche au moment du `fuse.search()`.

### Multi-mots AND (extended search)

Avec `useExtendedSearch: true`, Fuse interprète :
- `motA motB` → AND implicite (chaque mot doit matcher quelque part)

Implémentation : on transforme la query utilisateur en pattern Fuse :

```js
const pattern = query.trim().split(/\s+/).filter(Boolean).join(' ');
// Ex. "machine learning McGill" → "machine learning McGill"
// Fuse extended-search traite comme AND par défaut
```

### Indexation multilingue (champs structurés)

On dérive deux tables de mapping côté `index.html` (copie depuis
`join.html`/`edit.html`) :

```js
const STATUT_FR_TO_EN = {
  'Personne en recherche universitaire': 'University researcher',
  'Personne en recherche clinique universitaire': 'Clinical university researcher',
  'Personne en recherche au collégial': 'College researcher',
  'Autres statuts en recherche': 'Other research statuses',
  'Personne aux études au 1er cycle': 'Undergraduate student',
  'Personne aux études à la maîtrise': "Master's student",
  'Personne aux études au doctorat': 'PhD student',
  'Personne en stage postdoctoral': 'Postdoctoral fellow',
  'Personnel de recherche': 'Research staff',
  'Personnel de la santé': 'Health professional',
  "Coordination ou gestion d'équipe": 'Team coordination or management',
  'Personne en milieu industriel ou gouvernemental': 'Industry or government professional',
  'Personne partenaire citoyenne': 'Citizen partner',
  'Autre': 'Other',
};

const TYPE_FR_TO_EN = {
  'Régulier': 'Regular member',
  'Étudiant': 'Student member',
  'Partenaire': 'Partner member',
};
```

Ces tables seront **importées depuis un endroit unique** pour éviter la
duplication. Option pragmatique : créer `lib/taxonomy.js` (ou inline dans
un `<script>` partagé entre les 3 HTML). Pour l'instant, simple
duplication acceptable vu la taille ; on consolidera plus tard si Tess
ajoute encore des termes.

À l'indexation, pour chaque membre :

```js
fuseDoc = {
  ...m,
  statutFR: fold(m.statut),
  statutEN: fold(STATUT_FR_TO_EN[m.statut] || ''),
  typeFR:   fold(m.type),
  typeEN:   fold(TYPE_FR_TO_EN[m.type] || ''),
  // autres champs déjà fold()
};
```

### Intégration dans `applyFilters`

Logique actuelle :

```js
filteredMembers = allMembers.filter(m => {
  if (m.consent === 'non') return false;
  if (s && !m._search.includes(s)) return false;
  if (ft.length && !ft.includes(m.type)) return false;
  // ...
});
```

Logique cible :

```js
let pool = allMembers.filter(m => m.consent !== 'non');

// Filtres exacts d'abord (rapides)
pool = pool.filter(m => {
  if (ft.length && !ft.includes(m.type)) return false;
  if (fr.length && !memberMatchesRegions(m, fr)) return false;
  if (fs.length && !fs.includes(m.statutGroup)) return false;
  if (fa.length && !memberMatchesFocus(m, fa)) return false;
  return true;
});

// Recherche Fuse en aval (sur le pool déjà filtré, plus rapide)
if (queryNormalized) {
  const fuseOnPool = new Fuse(pool.map(toFuseDoc), fuseOptions);
  filteredMembers = fuseOnPool.search(queryNormalized).map(r => r.item._original);
} else {
  filteredMembers = pool;
}
```

**Choix retenu** : on indexe sur `pool` (déjà filtré) à la volée. Sur
~656 membres → indexation < 5 ms, négligeable. Cette approche est plus
simple à maintenir : pas de logique « chercher puis re-filtrer », juste
« filtrer puis chercher dans le sous-ensemble ».

Si le bottin grossit (> 10 000 membres) et qu'on observe une latence
notable, on basculera vers un index global construit une seule fois.

### Tri

- Si `query` non vide → ordre = score Fuse (les meilleurs en haut).
  `includeScore: true` puis tri ascendant sur `result.score` (Fuse
  retourne déjà trié, on garde tel quel).
- Si `query` vide → ordre actuel inchangé (tri alphabétique nom +
  `currentSortKey` du tableau).

### UX

- **Debounce 150 ms** sur l'input pour éviter de re-filtrer à chaque
  frappe (mais ressentir « instantané »).
- **Message 0 résultat** : ajouter une string i18n `search_no_results`
  qui s'affiche en lieu et place de la liste si `filteredMembers.length === 0`
  ET `query.length > 0`.
- Le compteur « X membres affichés » continue de fonctionner.
- Pas de modification visuelle des cards (pas de highlight).

## Tests attendus

### Manuel par Tess

1. Recherche **fautive** : taper `epidemiologie` (sans accents) → trouve
   les `épidémiologie` ; taper `machne` → trouve `machine learning`.
2. Recherche **multi-mots** : taper `IA McGill` → ne montre que les
   personnes qui matchent IA **et** McGill.
3. Recherche **bilingue** : taper `PhD student` → trouve les `Personne
   aux études au doctorat` ; taper `étudiant doctorat` → idem.
4. Recherche **insensible aux accents** : `francois` trouve `François`.
5. Recherche **par expertise** : taper un domaine (« biostatistique »,
   « cardiologie ») → membres pertinents en haut.
6. Recherche **vide** + filtres → comportement actuel inchangé.
7. Recherche + filtres combinés → AND respecté (ex. cocher Région=Mtl
   + taper « McGill » → membres McGill à Mtl uniquement).

### Tests de non-régression

- Le clic sur une card ouvre la modal (statu quo).
- La carte se met à jour avec les filtres + recherche.
- Le bouton « Réinitialiser » vide aussi la barre de recherche.
- L'export CSV n'est pas affecté.

## Plan de déploiement

1. Charger Fuse.js via CDN dans `index.html`.
2. Ajouter la fonction `fold()` et les tables `STATUT_FR_TO_EN` /
   `TYPE_FR_TO_EN`.
3. Construire l'index Fuse après `loadMembers`.
4. Modifier `applyFilters()` pour brancher Fuse quand query non vide.
5. Ajouter debounce sur l'input.
6. i18n : `search_no_results` FR + EN.
7. Push, hard refresh, tests par Tess.
8. Si OK → fermé. Sinon ajustements (poids, threshold).

## Risques et mitigations

- **Performance sur très gros bottin** : aujourd'hui 656 membres, Fuse
  ok jusqu'à ~10 000. Si le bottin grossit massivement, on évaluera
  un moteur dédié (Meilisearch, Algolia free-tier).
- **Bibliothèque externe via CDN** : si le CDN tombe, la recherche est
  inopérante. Mitigation : fallback gracieux (si `window.Fuse` n'existe
  pas, on retombe sur la recherche `includes` actuelle).
- **Faux positifs** : threshold 0.3 peut parfois sur-matcher. Si Tess
  trouve la recherche trop permissive après tests, on baisse à 0.25
  ou 0.2.
- **Maintenance des mappings FR↔EN** : si Tess ajoute une option
  statut/type, il faut penser à l'ajouter au mapping. Solution : un
  petit commentaire dans le code rappelant cette dépendance, et
  idéalement consolidation future dans `lib/taxonomy.js`.
