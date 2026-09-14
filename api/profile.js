/**
 * GET  /api/profile?token=xxx → returns member profile (pre-fill form)
 * POST /api/profile?token=xxx → updates member profile
 *
 * POST body extras (Phase 2a, 2026-05-04):
 *   - type           : 'Régulier' | 'Étudiant' | 'Partenaire'
 *   - newInstitutions: [{ name, address }] — new institutions to add
 *                      to the Notion Institutions DB (statut "En attente").
 *                      The member's "Institution liée" Relation is then
 *                      synced to all selected institutions.
 */
const {
  getProfile, updateProfile,
  findInstitutionByName, createInstitution, setMemberInstitutionRelation,
  uploadMemberPhoto, removeMemberPhoto,
} = require('../lib/notion');
const { verifyToken } = require('../lib/token');
const { geocodeAddress } = require('../lib/geocode');
const { decodePhotoDataUrl, photoFilename } = require('../lib/photo');

module.exports.config = { maxDuration: 30 };

// Fields that members can edit themselves
const EDITABLE_FIELDS = [
  'prenom', 'nom', 'email', 'email2', 'institution', 'statut', 'type',
  'reseau', 'themes', 'projet', 'etudiants',
  'axes', 'principes', 'champs', 'orcid', 'cv', 'consent',
  'afficherCourriel', // Phase 2f (2026-05-04): toggle email public
  'evaluateur',       // Phase 2i (2026-05-04): Oui/Non/Incertain
];

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.query.token || req.headers['x-token'];
  if (!token) return res.status(401).json({ error: 'Token required' });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  try {
    if (req.method === 'GET') {
      const profile = await getProfile(payload.pageId);
      return res.status(200).json(profile);
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      // Only allow editable fields
      const data = {};
      for (const key of EDITABLE_FIELDS) {
        if (body[key] !== undefined) data[key] = body[key];
      }

      // Phase 3a (2026-09-14): photo de profil. body.photo = data URL d'une
      // nouvelle photo ; body.removePhoto = true pour retirer l'actuelle.
      // Validee avant toute ecriture.
      let photo = null;
      if (body.photo) {
        try {
          photo = decodePhotoDataUrl(body.photo);
        } catch (photoErr) {
          return res.status(400).json({ ok: false, code: photoErr.code || 'PHOTO_INVALID' });
        }
      }
      const removePhoto = body.removePhoto === true && !photo;

      if (Object.keys(data).length === 0 && !photo && !removePhoto) {
        return res.status(400).json({ error: 'No editable fields provided' });
      }

      // Phase 2e (2026-05-04): regle metier — droit de vote = type Regulier.
      // Si le type d'adhesion est dans la requete, on calcule droitVote
      // cote serveur (le client ne peut pas l'envoyer directement, il
      // n'est pas dans EDITABLE_FIELDS). Cela ajuste automatiquement quand
      // un membre passe Etudiant -> Regulier ou inverse.
      if (data.type !== undefined) {
        data.droitVote = (data.type === 'Régulier');
      }

      // Phase 2a: handle institution Relation sync + new institutions creation.
      // Same logic as api/join.js, factorized only for the institution part
      // (profile already exists so no createMember).
      const institutionString = data.institution; // 'A; B; C'
      const newInstitutions = Array.isArray(body.newInstitutions) ? body.newInstitutions : [];

      // 1) Update the editable fields first (keeps the rest in sync if institutions fail)
      await updateProfile(payload.pageId, data);

      // 1b) Photo : televersement ou retrait. Une erreur ici ne perd pas
      // les autres modifications, mais est signalee au client.
      let photoError = null;
      try {
        if (photo) {
          await uploadMemberPhoto(payload.pageId, photo.buffer, photo.contentType, photoFilename(photo.ext));
        } else if (removePhoto) {
          await removeMemberPhoto(payload.pageId);
        }
      } catch (photoErr) {
        console.error('[profile] Photo update failed:', photoErr.message);
        photoError = 'PHOTO_UPLOAD_FAILED';
      }

      // 2) Process new institutions (geocode + create as "En attente")
      // Failures here don't break the save — the profile is already updated.
      for (const inst of newInstitutions) {
        const name = (inst && inst.name || '').trim();
        const address = (inst && inst.address || '').trim();
        if (!name || !address) continue;
        try {
          const existing = await findInstitutionByName(name);
          if (existing) continue; // already in catalog (any status)
          let coords = null;
          try {
            coords = await geocodeAddress(address);
          } catch (geoErr) {
            console.error(`[profile] Geocoding failed for "${name}":`, geoErr.message);
          }
          await createInstitution({
            name,
            address,
            latitude: coords ? coords.lat : null,
            longitude: coords ? coords.lng : null,
            statut: 'En attente',
          });
        } catch (instErr) {
          console.error(`[profile] Failed to add institution "${name}":`, instErr.message);
        }
      }

      // 3) Sync the "Institution liée" Relation with the selected institutions
      // Only run if institution string was provided in the body
      if (institutionString !== undefined) {
        try {
          const names = String(institutionString).split(';').map(s => s.trim()).filter(Boolean);
          const linkedIds = [];
          for (const name of names) {
            try {
              const page = await findInstitutionByName(name);
              if (page && !linkedIds.includes(page.id)) linkedIds.push(page.id);
            } catch (err) {
              console.error(`[profile] findInstitutionByName failed for "${name}":`, err.message);
            }
          }
          await setMemberInstitutionRelation(payload.pageId, linkedIds);
        } catch (linkErr) {
          console.error('[profile] Setting institution relation failed:', linkErr.message);
        }
      }

      return res.status(200).json({ ok: true, message: 'Profile updated', photoError });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Profile error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
