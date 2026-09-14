# Vue Connexions — graphe de proximité entre membres

**Date** : 2026-05-04
**Branche** : `connexions`
**Statut** : prêt à implémenter

## Contexte

Le bottin actuel propose 3 vues (Profils, Tableau, Carte) + filtres + recherche
améliorée Fuse.js. Aucune vue ne montre les **connexions implicites** entre
membres : qui partage des intérêts ou des thématiques avec qui.

Deux usages identifiés avec Tess :

- **A1 — Membres** : trouver des collaborateur·rices potentiel·les qui partagent
  des sujets de recherche.
- **A3 — Admin (Tess)** : identifier des duos potentiels à mettre en relation,
  notamment lorsqu'ils sont dans des institutions différentes.

## Décisions actées

- **Approche** : Option N2 — page dédiée « Connexions » (4e vue à côté de Profils
  / Tableau / Carte) avec graphe force-directed inspiré d'Obsidian.
- **Calcul de similarité** : option B2 — catégories (axes / principes / champs)
  + tokens des champs libres (expertise, thèmes, projet). Pondération forte sur
  les champs libres (catégories sur-renseignées historiquement).
- **Bibliothèque graphe** : `vis-network` 9.x via CDN.
- **Pas de SaaS payant** ni d'infrastructure additionnelle.
- **Privacy** : seuls les membres avec `consent === 'oui'` apparaissent dans le
  graphe (idem que les autres vues publiques).
- **Bonus admin** : panneau « Insights » avec top 10 paires inter-institutions
  + bouton export PNG du graphe.

## Périmètre

### En scope

1. Charger `vis-network` via CDN dans `index.html` (Leaflet, Fuse.js et
   Markercluster sont déjà chargés en CDN, on suit le même pattern).
2. Ajouter un 4e onglet **Connexions** dans le bandeau de vues (à côté de Profils
   / Tableau / Carte).
3. Calculer la similarité entre tous les membres consentants côté client (one-shot
   au chargement de la vue, pas de cache serveur).
4. Construire et afficher le graphe :
   - Nœuds colorés par type d'adhésion (Régulier=bleu, Étudiant=jaune, Partenaire=vert)
   - Taille du nœud proportionnelle au degré (nombre de connexions)
   - Liens d'épaisseur variable selon le score
5. Interactions : clic ouvre la modal du membre (réutilise le code existant) ;
   survol met en évidence le voisinage immédiat (effet Obsidian).
6. Panneau latéral droit avec :
   - Search par nom / institution (focus + zoom sur le nœud trouvé)
   - Filtres type / région / axe (estompent les non-matchants)
   - Légende des couleurs
   - Compteur « X membres affichés, Y connexions »
7. Bouton **« Exporter en image »** (canvas → PNG download) pour les rapports.
8. Panneau **« Insights »** admin (visible par tous mais utile surtout à Tess) :
   top 10 des paires inter-institutions avec score le plus élevé.
9. i18n complet FR + EN.
10. Comportement responsive : sur mobile (< 768 px), le graphe occupe toute la
    largeur, le panneau latéral se replie en accordéon top.

### Hors scope (réservé pour N3 plus tard)

- Clustering automatique (groupes par institution / axe).
- Statistiques avancées (communautés détectées, métriques de centralité).
- Layouts personnalisés persistants.
- Animations chronologiques (évolution dans le temps).
- Filtres combinables AND/OR sur les liens.

## Détails techniques

### Algorithme de similarité

```
function fold(s) → enleve les diacritiques + lowercase (deja existe pour Fuse)

const STOPWORDS_FR = new Set(['le','la','les','de','des','du','et','ou','a','au',
  'aux','pour','sur','dans','avec','par','d','l','un','une','en','est','que','qui',
  'ce','cette','ces','sa','son','ses','leur','leurs','notre','nos','votre','vos','je',
  'tu','il','elle','nous','vous','ils','elles','mon','ton','plus','moins','tres']);
const STOPWORDS_EN = new Set(['the','a','an','and','or','in','on','at','for','with',
  'by','of','to','is','are','was','were','be','been','being','have','has','had','do',
  'does','did','will','would','should','could','may','might','this','that','these',
  'those','from','as','it','its','he','she','they','we','you','i']);
const STOPWORDS = STOPWORDS_FR ∪ STOPWORDS_EN;

function tokenize(text) {
  if (!text) return [];
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

function similarityScore(a, b) {
  if (a.id === b.id) return 0;
  let score = 0;

  // Categories partagees (poids 1)
  const sharedAxes = (a.axes || []).filter(x => (b.axes || []).includes(x));
  const sharedPrinc = (a.principes || []).filter(x => (b.principes || []).includes(x));
  const sharedChamps = (a.champsAction || []).filter(x => (b.champsAction || []).includes(x));
  score += sharedAxes.length + sharedPrinc.length + sharedChamps.length;

  // Tokens partages dans champs libres (poids 2)
  const tokensA = new Set([
    ...tokenize(a.expertise), ...tokenize(a.themes), ...tokenize(a.projet)
  ]);
  const tokensB = new Set([
    ...tokenize(b.expertise), ...tokenize(b.themes), ...tokenize(b.projet)
  ]);
  let commonTokens = 0;
  for (const t of tokensA) if (tokensB.has(t)) commonTokens++;
  score += commonTokens * 2;

  // Normalise approximativement [0..1]. Max realiste observe ~30, on cap a 30
  // pour eviter les hubs degeneres ; au-dela on considere "1" (similarite max).
  return Math.min(score / 30, 1);
}
```

### Optimisation pour 656 membres

Calcul naïf O(n²) sur 210 membres consentants = 22 000 paires. Faisable en JS
pur en quelques secondes. Pour rester perfomant :

- **Pré-tokeniser** tous les membres une fois (cache local sur l'objet).
- **Index inversé** token → Set de membres : pour ne comparer que les paires
  qui partagent au moins un token (skip les pairs sans intersection).
- Faire le calcul **dans un setTimeout** ou requestIdleCallback pour ne pas
  bloquer le thread principal pendant > 100 ms. Afficher un spinner.

Si en pratique on observe des freezes > 1 s, on basculera en Web Worker (overkill
pour cette taille).

### Sélection des liens à afficher

Pour 210 membres et un score moyen non nul, on aurait potentiellement ~5000
liens. Trop pour un graphe lisible.

Stratégie : **top-K par nœud** (K=5 par défaut). Pour chaque membre, on garde
les 5 voisins les plus similaires (avec score > 0.10 pour éviter les liens
faiblards). Les liens sont **non orientés** : si A → B et B → A apparaissent,
on garde un seul lien (avec le max des scores).

Total estimé : ~600-800 liens, lisible.

### Configuration vis-network

```js
const options = {
  nodes: {
    shape: 'dot',
    borderWidth: 2,
    font: { size: 12, color: '#1a202c' },
    scaling: { min: 8, max: 30 },
  },
  edges: {
    smooth: { type: 'continuous', roundness: 0.2 },
    color: { color: '#cbd5e0', highlight: '#a855f7', hover: '#a855f7' },
    width: 1,
    scaling: { min: 0.5, max: 4 },
    hoverWidth: 1.5,
  },
  physics: {
    forceAtlas2Based: {
      gravitationalConstant: -50,
      centralGravity: 0.01,
      springLength: 100,
      springConstant: 0.08,
    },
    solver: 'forceAtlas2Based',
    stabilization: { iterations: 200 },
  },
  interaction: {
    hover: true,
    tooltipDelay: 200,
    zoomView: true,
    dragNodes: true,
  },
};
```

Couleurs par type :

```js
const TYPE_COLORS = {
  Régulier: { background: '#bee3f8', border: '#2b6cb0' },
  Étudiant: { background: '#fefcbf', border: '#975a16' },
  Partenaire: { background: '#c6f6d5', border: '#276749' },
  default:   { background: '#e2e8f0', border: '#718096' },
};
```

### Mise en évidence du voisinage (effet Obsidian)

Au survol/clic sur un nœud :
- Le nœud + ses voisins immédiats restent à 100 % d'opacité.
- Tous les autres nœuds passent à 20 % d'opacité.
- Les liens vers les voisins sont mis en évidence (mauve) ; les autres liens
  sont à 10 % d'opacité.

Implémentation : on écoute `network.on('hoverNode', ...)` et `network.on('blurNode', ...)`,
on parcourt les nœuds et liens, et on update via `network.body.data.nodes.update(...)`.

### Filtres latéraux

Réutilise les états existants `msState.filterType` etc. Quand un filtre change :

- Les nœuds qui ne matchent pas → `opacity: 0.15`
- Les liens dont au moins une extrémité ne matche pas → `opacity: 0.10`
- Les nœuds qui matchent → `opacity: 1`

Pas de masquage complet (on garde la structure du graphe visible, comme Obsidian).

### Search bar

Input texte dans le panneau latéral. À chaque keypress :
- Trouve le 1er nœud dont le label/institution matche (case-insensitive,
  diacritics-folded).
- `network.focus(nodeId, { scale: 1.5, animation: true })`
- Met le nœud + voisins en évidence (effet survol forcé).

### Panneau Insights admin

En bas du panneau latéral, un accordéon « 💡 Insights ».

Contenu : top 10 des paires `(A, B)` telles que :
- Score > 0.30 (paire vraiment proche)
- `A.institution !== B.institution` (potentielle connexion inter-institutions)
- Triées par score décroissant

Chaque entrée : `Marie X (McGill) ↔ Jean Y (UQAM) — 7 critères en commun`,
clic → ouvre la modal de l'un, survol → met les 2 en évidence sur le graphe.

### Export PNG

```js
const canvas = network.canvas.frame.canvas;
const url = canvas.toDataURL('image/png');
// trigger download
const a = document.createElement('a');
a.href = url;
a.download = 'rsn-connexions-' + new Date().toISOString().slice(0, 10) + '.png';
a.click();
```

### Onglet et navigation

Réutilise le pattern existant des vues (Profils / Tableau / Carte) :

```js
// existant
let currentView = 'cards' | 'table' | 'map';
// ajout
currentView = 'connexions';
```

Bouton "Connexions" à côté des autres dans `.view-toggle`. Le state est dans
le hash URL (`#view=connexions`), comme les autres vues, pour permettre les
liens directs partagés.

### Performance et UX

- Au switch vers la vue Connexions, **construire le graphe en lazy** (premier
  affichage) : afficher un spinner « Calcul des connexions… » pendant ~1-2 s.
- **Cache** : une fois calculé, on garde la liste des nœuds et liens en mémoire.
  Si l'utilisateur revient sur cette vue, on réaffiche directement.
- Si `allMembers` change (ex. cache rafraîchi en background), invalider le cache.

### i18n

Nouveaux libellés à ajouter :

| Key | FR | EN |
|---|---|---|
| `view_connexions` | Connexions | Connections |
| `connexions_loading` | Calcul des connexions… | Computing connections… |
| `connexions_search_placeholder` | Rechercher un membre… | Search a member… |
| `connexions_count_legend` | {N} membres, {L} connexions affichées | {N} members, {L} connections shown |
| `connexions_export_png` | Exporter en image | Export as image |
| `connexions_insights_title` | Connexions inter-institutions à fort potentiel | High-potential cross-institution pairs |
| `connexions_pair_score` | {N} critères en commun | {N} criteria in common |

### Non-régression

- Les 3 autres vues (Profils, Tableau, Carte) doivent rester intactes.
- Les filtres (Type, Région, Statut, Focus) doivent fonctionner sur Connexions.
- La recherche Fuse de la barre principale n'est pas réutilisée ici (la search
  bar du panneau Connexions est dédiée — match plus strict pour focus précis).

## Plan d'implémentation

1. **Commit 1** — Spec + bootstrap : ce document, charger `vis-network` via CDN.
2. **Commit 2** — Squelette de la vue : onglet, container, switch logique.
3. **Commit 3** — Calcul de similarité + génération nœuds/liens.
4. **Commit 4** — Affichage du graphe + interactions (clic, hover).
5. **Commit 5** — Panneau latéral filtres + search + légende + compteur.
6. **Commit 6** — Insights admin + export PNG.
7. **Commit 7** — i18n + responsive + polish.

Tess teste l'URL preview Vercel après chaque commit pertinent. Quand satisfaite
sur la branche, on merge `connexions` → `main` pour déployer en prod.

## Tests attendus

- **Volume** : graphe affiché avec ~210 nœuds + ~700 liens, lisible.
- **Performance** : calcul < 3 s en cold start, switch vers la vue < 100 ms après cache.
- **Interactions** : clic ouvre la modal, hover met le voisinage en évidence,
  drag fonctionne, zoom marche.
- **Filtres** : cocher un type / région / axe estompe les non-matchants sans
  casser la structure.
- **Search** : taper un nom focus immédiatement.
- **Insights** : top 10 inter-institutions affichés et cliquables.
- **Export** : bouton génère un PNG téléchargé.
- **Mobile** : panneau latéral se replie, graphe utilisable au touch.
- **Regression** : Profils / Tableau / Carte / filtres existants intacts.

## Révision v7 (2026-09-14) : qualité des mots communs et densité

Constat sur les 277 profils consentants : le filtre DF à 35 % n'écartait que 4 mots
(health, digital, research, data). Des mots comme « afin », « vise », « project »,
« clinical » portaient l'essentiel des 1 158 liens ; « intelligence » + « artificial »
comptaient pour 2 mots communs alors que c'est un seul concept ; un membre cumulait
55 liens. Calibrage : `scratchpad/connexions_analysis3.py` (hors dépôt).

Décisions :

- **Mots vides supplémentaires** (`CONNEXIONS_EXTRA_STOPWORDS`), réservés aux
  connexions, jamais à la recherche (qui a besoin de « santé »/« health » pour le pont
  FR↔EN). Quatre familles : liaison FR oubliés, génériques de la recherche FR+EN
  (cibles du dictionnaire incluses), vocabulaire commun à tout le réseau, noms
  d'institutions et de lieux (l'affinité doit venir de l'expertise, pas de l'employeur).
- **Bigrammes adjacents** : « intelligence artificielle » et « artificial intelligence »
  donnent la même clé triée `artificial+intelligence`. Un bigramme partagé absorbe ses
  deux mots (pas de triple compte).
- **Score pondéré par la rareté** : somme des poids idf `min(log(N/df), 4)` des items
  partagés, bigramme × 1,25. Fenêtre DF `[2, 20 %]`. Un lien exige au moins 2 items
  partagés ou 1 bigramme : un seul mot commun n'est pas un signal.
- **Sélection des liens** : seuil (curseur, défaut 4), top-4 voisins par membre (union),
  puis plafond de 10 liens par membre en traitant les liens du plus fort au plus faible.
- **UI** : curseur « Liens : tous ↔ les plus forts » (4 → 15) et case « Masquer les
  membres sans lien » dans la légende ; sélection rejouée sans reconstruire le graphe.
  Le survol d'un lien affiche les items partagés.
- **Un seul index** (`ensureConnexionsIndex`) pour le graphe et le bloc « Profils
  proches » de la modal ; le nombre affiché est le nombre d'items partagés.

Un seul mot partagé suffit s'il est rare (`SINGLE_MIN_WEIGHT`, poids idf ≥ 3,5, soit
présent dans au plus ~3 % des profils) : « telehealth » ou « amblyopia » relient, pas
« learning ».

Résultat (277 membres) : ~600 liens au seuil 4, degré max 10, ~30 isolés (profils
trop courts). Paramètres dans `CONNEXIONS_PARAMS`.

### Validation par groupes thématiques (2026-09-14)

Balayage complet des 1 232 mots retenus (`scratchpad/vocab_kept.txt`) pour exclure
verbes, adverbes, quantités et mots d'organisation, FR et EN, plus ~180 entrées ajoutées
au dictionnaire FR→EN pour le vocabulaire scientifique (télésanté/telehealth,
neuroimagerie/neuroimaging, aidants/caregivers, cohorte/cohort, IRM/MRI…).

Métrique (`scratchpad/connexions_eval2.py`) : part des membres d'un groupe thématique
(repéré par expression régulière dans les textes) qui ont au moins un voisin affiché du
même groupe.

| Groupe | Couverture |
|---|---|
| télésanté | 7/9 |
| éthique | 12/15 |
| santé mentale | 14/18 |
| réadaptation | 18/21 |
| oncologie | 21/22 |
| imagerie | 28/30 |
| soins infirmiers | 8/9 |
| pédiatrie | 15/16 |

Les mots communs à tout le réseau (« santé », « soins », « clinique », « données ») ne
sont pas dans les mots vides : le plafond DF les élimine comme mots seuls, mais ils
restent disponibles pour les bigrammes (« santé mentale », « soins intensifs »), ce qui a
fait passer la santé mentale de 11/18 à 14/18.

Avant la révision (v4), ces mêmes groupes étaient reliés surtout par des mots
génériques ; le curseur à 8 fait tomber la télésanté à 0/9, ce qui montre que les liens
thématiques sont dans la zone 4 à 6 du score.

Les membres non couverts ont des profils courts ou rédigés en termes génériques.
