/**
 * POST /api/join
 * Body: { prenom, nom, email, statut, institution, type, themes, cv, orcid, refere, reseau, axes, principes, champs, consent }
 *
 * Creates a new member in Notion with workflow status "Nouveau".
 * Checks for duplicate email before creating.
 */
const { findByEmail, createMember, findInstitutionByName, createInstitution } = require('../lib/notion');
const { sendJoinConfirmation } = require('../lib/email');
const { geocodeAddress } = require('../lib/geocode');

// Simple in-memory rate limiter
const attempts = new Map();
const RATE_LIMIT = 5;       // max submissions per hour per IP
const RATE_WINDOW = 3600000; // 1 hour

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  // Basic validation
  const { prenom, nom, email, statut, institution, type, themes, axes, consent } = body;
  if (!prenom || !nom || !email || !statut || !institution || !type || !themes || !axes || !axes.length || !consent) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  // Rate limiting by IP
  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  const now = Date.now();
  const history = (attempts.get(ip) || []).filter(function(t) { return now - t < RATE_WINDOW; });
  if (history.length >= RATE_LIMIT) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  history.push(now);
  attempts.set(ip, history);

  try {
    // Check for duplicate email
    const normalized = email.toLowerCase().trim();
    const existing = await findByEmail(normalized);
    if (existing) {
      return res.status(409).json({ ok: false, code: 'DUPLICATE' });
    }

    // Create the member
    await createMember({
      prenom: prenom.trim(),
      nom: nom.trim(),
      email: normalized,
      email2: (body.email2 || '').toLowerCase().trim() || null,
      statut: statut.trim(),
      institution: institution.trim(),
      type: type.trim(),
      themes: (themes || '').trim(),
      cv: body.cv || null,
      orcid: body.orcid || null,
      refere: (body.refere || '').trim(),
      reseau: (body.reseau || '').trim(),
      axes: axes || [],
      principes: body.principes || [],
      champs: body.champs || [],
      consent: consent,
    });

    // Send confirmation email (non-blocking — failure shouldn't break the submission)
    try {
      await sendJoinConfirmation(normalized, prenom.trim());
    } catch (mailErr) {
      console.error('Join confirmation email failed:', mailErr.message);
    }

    // Process new institutions submitted by the member.
    // Each one is geocoded via Nominatim and added to the Notion "Institutions"
    // database with status "En attente" so the admin can review/correct.
    // Failures here don't break the join flow — the member is already created.
    const newInstitutions = Array.isArray(body.newInstitutions) ? body.newInstitutions : [];
    for (const inst of newInstitutions) {
      const name = (inst && inst.name || '').trim();
      const address = (inst && inst.address || '').trim();
      if (!name || !address) continue;

      try {
        // Skip if an institution with the same name already exists (any status)
        const existing = await findInstitutionByName(name);
        if (existing) {
          console.log(`[join] Institution "${name}" already exists in Notion, skipping`);
          continue;
        }

        let coords = null;
        try {
          coords = await geocodeAddress(address);
        } catch (geoErr) {
          console.error(`[join] Geocoding failed for "${name}":`, geoErr.message);
        }

        await createInstitution({
          name,
          address,
          latitude: coords ? coords.lat : null,
          longitude: coords ? coords.lng : null,
          statut: 'En attente',
        });
        console.log(`[join] New institution "${name}" added to Notion (En attente)`);
      } catch (instErr) {
        console.error(`[join] Failed to add institution "${name}":`, instErr.message);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Join error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports.config = { maxDuration: 30 };
