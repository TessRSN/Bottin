/**
 * GET /api/photo?id=<pageId>&v=<version>
 *
 * Relais des photos de profil stockées dans Notion. Les fichiers Notion ont
 * des adresses qui expirent après une heure : on ne peut donc pas les mettre
 * dans l'export quotidien. Ce relais va chercher l'image au moment de
 * l'affichage et laisse le CDN de Vercel la garder en cache une journée
 * (clé de cache = id + v, v = nom horodaté du fichier, donc une nouvelle
 * photo a une nouvelle adresse).
 *
 * Ne sert que les membres approuvés ayant consenti au profil public.
 */
const { getMemberPhoto } = require('../lib/notion');

module.exports.config = { maxDuration: 15 };

const MAX_BYTES = 3 * 1024 * 1024;

function isPageId(s) {
  if (typeof s !== 'string') return false;
  const hex = s.replace(/-/g, '').toLowerCase();
  if (hex.length !== 32) return false;
  for (const c of hex) if ('0123456789abcdef'.indexOf(c) < 0) return false;
  return true;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const id = req.query.id;
  if (!isPageId(id)) return res.status(400).end();

  try {
    const info = await getMemberPhoto(id);
    const consentOk = String(info.consent || '').trim().toLowerCase().startsWith('oui');
    if (!info.photo || !info.photo.url || info.workflow !== 'Approuvé' || !consentOk) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(404).end();
    }

    const upstream = await fetch(info.photo.url);
    if (!upstream.ok) return res.status(502).end();
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return res.status(502).end();
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_BYTES) return res.status(502).end();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('[photo] error:', err.message);
    return res.status(500).end();
  }
};
