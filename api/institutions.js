/**
 * GET /api/institutions
 *
 * Retourne la liste des institutions avec statut "Validée" depuis la base
 * Notion "Institutions". Utilisé par:
 *   - index.html : pour géolocaliser les membres sur la carte
 *   - join.html  : pour l'autocomplete du champ institution
 *
 * Format de réponse:
 *   {
 *     "McGill University": [45.5048, -73.5772],
 *     "Université Laval": [46.7808, -71.2758],
 *     ...
 *   }
 *
 * Compatible ETag pour cache HTTP — les clients qui ont déjà la version
 * actuelle reçoivent un 304 Not Modified sans body.
 */
const crypto = require('crypto');
const { getValidatedInstitutions, getAllInstitutions } = require('../lib/notion');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Admin mode: ?all=true&key=SECRET returns the FULL list (incl. En attente / Refusée)
  // for inspection purposes (looking for duplicates etc.)
  if (req.query && req.query.all === 'true') {
    if (!req.query.key || req.query.key !== process.env.BACKUP_SECRET) {
      return res.status(401).json({ error: 'Unauthorized for admin mode' });
    }
    const all = await getAllInstitutions();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(JSON.stringify(all, null, 2));
  }

  try {
    const institutions = await getValidatedInstitutions();

    // Build canonical { name: [lat, lng] } object, sorted by name for stable ETag
    const sorted = institutions.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const out = {};
    for (const inst of sorted) {
      out[inst.name] = [inst.lat, inst.lng];
    }

    // 2026-09-15 : cle du fond de carte CARTO (CARTO_BASEMAP_KEY, variable
    // Vercel), transmise par en-tete pour que index.html l'utilise sans
    // qu'elle figure dans le depot. Une cle de tuiles est de toute facon
    // visible dans les requetes du navigateur ; elle est restreinte au domaine
    // dans le tableau de bord CARTO.
    // Vercel retire les en-tetes personnalises des reponses 304 : la cle fait
    // donc partie de l'empreinte ETag, pour qu'un navigateur dont le cache
    // date d'avant la cle (ou d'une cle precedente) recoive une reponse 200
    // complete, avec l'en-tete.
    const basemapKey = (process.env.CARTO_BASEMAP_KEY || '').trim();
    if (basemapKey) res.setHeader('X-Basemap-Key', basemapKey);

    const json = JSON.stringify(out);
    const etag = '"' + crypto.createHash('md5').update(json + '|' + basemapKey).digest('hex') + '"';

    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      return res.status(304).end();
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.status(200).send(json);
  } catch (err) {
    console.error('Institutions error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch institutions', detail: err.message });
  }
};

module.exports.config = { maxDuration: 30 };
