/**
 * Photo de profil : validation et décodage de l'image envoyée par le
 * navigateur (data URL JPEG/PNG/WebP, déjà recadrée en carré 512 px par
 * photo-cropper.js). Partagé par api/join.js et api/profile.js.
 */

const MAX_BYTES = 700 * 1024; // le recadrage produit ~40-150 Ko ; large marge
const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Décode une data URL en { buffer, contentType, ext }.
 * Lève une Error avec .code = 'PHOTO_INVALID' | 'PHOTO_TOO_LARGE'.
 */
function decodePhotoDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) throw photoError('PHOTO_INVALID');
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw photoError('PHOTO_INVALID');
  const header = dataUrl.slice(5, comma); // ex. "image/jpeg;base64"
  const parts = header.split(';');
  const contentType = parts[0];
  if (!ALLOWED[contentType] || parts[1] !== 'base64') throw photoError('PHOTO_INVALID');
  const b64 = dataUrl.slice(comma + 1);
  // Taille approximative avant décodage (évite de décoder un gros fichier pour rien)
  if (b64.length * 0.75 > MAX_BYTES) throw photoError('PHOTO_TOO_LARGE');
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_BYTES) throw photoError('PHOTO_TOO_LARGE');
  if (!magicMatches(buffer, contentType)) throw photoError('PHOTO_INVALID');
  return { buffer, contentType, ext: ALLOWED[contentType] };
}

// Vérifie que le contenu correspond bien au type annoncé (octets de signature)
function magicMatches(buf, contentType) {
  if (contentType === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (contentType === 'image/png') return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (contentType === 'image/webp') return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function photoError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

/** Nom de fichier horodaté : sert aussi de version pour le cache du relais /api/photo */
function photoFilename(ext) {
  return `photo-${Date.now()}.${ext}`;
}

module.exports = { decodePhotoDataUrl, photoFilename, MAX_BYTES };
