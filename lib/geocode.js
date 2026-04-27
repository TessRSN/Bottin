/**
 * Geocode an address to lat/lng coordinates using OpenStreetMap Nominatim.
 *
 * Free service, no API key required, but with usage policy:
 *   - Max 1 request per second
 *   - User-Agent header is mandatory and must identify the app
 *   - https://operations.osmfoundation.org/policies/nominatim/
 *
 * Returns { lat, lng } on success, or null if no result found.
 * Throws on network/server errors so the caller can decide what to do.
 */
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'RSN-Bottin/1.0 (https://bottin-gamma.vercel.app, contact: rsn.gestion@rimuhc.ca)';

async function geocodeAddress(address) {
  if (!address || !address.trim()) return null;

  const params = new URLSearchParams({
    q: address.trim(),
    format: 'json',
    limit: '1',
    addressdetails: '0',
  });

  const url = `${NOMINATIM_URL}?${params.toString()}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  });

  if (!resp.ok) {
    throw new Error(`Nominatim returned ${resp.status}`);
  }

  const results = await resp.json();
  if (!Array.isArray(results) || results.length === 0) return null;

  const lat = parseFloat(results[0].lat);
  const lng = parseFloat(results[0].lon);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

  return { lat, lng };
}

module.exports = { geocodeAddress };
