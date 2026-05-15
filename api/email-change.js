/**
 * Phase 2b (2026-05-04) — flow de changement de courriel principal avec
 * confirmation par magic link (P.C avec D.2).
 *
 *  POST /api/email-change?token=<editToken>
 *    Body: { newEmail, lang }
 *    Verifie l'editToken (donne par /api/magic-link), s'assure que le
 *    nouveau courriel n'est pas deja utilise par un autre membre, signe
 *    un emailChangeToken (1h) et envoie un courriel de confirmation
 *    au NOUVEAU courriel. Le profile reste inchange tant que la personne
 *    ne clique pas le lien.
 *    Repond { ok: true } meme en cas d'echec silencieux d'envoi pour
 *    eviter les race conditions cote UI (l'UI affiche toujours le meme
 *    message "courriel envoye, verifiez").
 *
 *  GET /api/email-change?token=<emailChangeToken>
 *    Verifie le token. Si valide :
 *      - email   := newEmail
 *      - email2  := oldEmail (ancien principal devient secondaire)
 *    Repond une petite page HTML de confirmation (pas de redirect pour
 *    eviter l'invalidation du token sur double clic).
 */
const { findByEmail, getProfile, updateProfile } = require('../lib/notion');
const { verifyToken, signEmailChangeToken } = require('../lib/token');
const { sendEmailChangeConfirmation } = require('../lib/email');

module.exports.config = { maxDuration: 30 };

function htmlPage(lang, success, message) {
  const isFr = lang === 'fr';
  const title = success
    ? (isFr ? 'Courriel mis à jour' : 'Email updated')
    : (isFr ? 'Erreur' : 'Error');
  const cta = isFr ? 'Retour au bottin' : 'Back to directory';
  const color = success ? '#22543d' : '#9b2c2c';
  const bg = success ? '#c6f6d5' : '#fed7d7';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RSN — ${title}</title>
<style>
  * { box-sizing:border-box; margin:0 }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
         background:#f7fafc; color:#1a202c; min-height:100vh;
         display:flex; align-items:center; justify-content:center; padding:1rem }
  .card { background:#fff; border-radius:1rem; padding:2.5rem; max-width:480px; width:100%;
          box-shadow:0 4px 24px rgba(0,0,0,.1); text-align:center }
  h1 { font-size:1.4rem; color:#2b6cb0; margin-bottom:1rem }
  .msg { padding:1rem; border-radius:.5rem; background:${bg}; color:${color};
         font-size:.95rem; line-height:1.5; margin-bottom:1.5rem }
  a.btn { display:inline-block; padding:.7rem 2rem; background:#2b6cb0; color:#fff;
          text-decoration:none; border-radius:.5rem; font-weight:600 }
</style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <div class="msg">${message}</div>
    <a class="btn" href="/">${cta}</a>
  </div>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  // CORS (memes regles que api/profile.js)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ─── POST: demande de changement (envoie magic link au nouveau courriel) ───
  if (req.method === 'POST') {
    const editToken = req.query.token || req.headers['x-token'];
    if (!editToken) return res.status(401).json({ error: 'Token required' });
    const payload = verifyToken(editToken);
    if (!payload || payload.kind !== 'edit') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const body = req.body || {};
    const newEmail = (body.newEmail || '').toLowerCase().trim();
    const lang = body.lang === 'en' ? 'en' : 'fr';
    if (!newEmail || !newEmail.includes('@')) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    try {
      const profile = await getProfile(payload.pageId);
      const oldEmail = (profile.email || '').toLowerCase().trim();
      if (!oldEmail) {
        return res.status(400).json({ error: 'No primary email on profile' });
      }
      if (newEmail === oldEmail) {
        return res.status(400).json({ error: 'New email is the same as the current one' });
      }

      // Refus si un autre membre utilise deja ce courriel (principal OU secondaire)
      const existing = await findByEmail(newEmail);
      if (existing && existing.id !== payload.pageId) {
        // On ne dit pas explicitement "ce courriel est deja utilise" pour ne
        // pas reveler l'existence d'autres membres. Message generique.
        return res.status(409).json({ ok: false, code: 'EMAIL_TAKEN' });
      }

      const name = `${profile.prenom || ''} ${profile.nom || ''}`.trim() || 'Membre';
      const changeToken = signEmailChangeToken(payload.pageId, oldEmail, newEmail);
      const baseUrl = process.env.BASE_URL || 'https://bottin.rsn.quebec';
      const confirmUrl = `${baseUrl}/api/email-change?token=${changeToken}&lang=${encodeURIComponent(lang)}`;

      try {
        await sendEmailChangeConfirmation(newEmail, name, confirmUrl, oldEmail, lang);
      } catch (mailErr) {
        console.error('Email change confirmation send failed:', mailErr && mailErr.message);
        // On ne renvoie pas l'erreur a l'utilisateur (toujours 200) pour ne
        // pas reveler des problemes d'infra. On log juste.
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Email change request error:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // ─── GET: confirmation du changement (clic sur le lien dans le courriel) ───
  if (req.method === 'GET') {
    const lang = req.query.lang === 'en' ? 'en' : 'fr';
    const isFr = lang === 'fr';
    const changeToken = req.query.token;
    if (!changeToken) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(htmlPage(lang, false,
        isFr ? 'Lien invalide.' : 'Invalid link.'));
    }
    const payload = verifyToken(changeToken);
    if (!payload || payload.kind !== 'email-change') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(401).send(htmlPage(lang, false,
        isFr ? 'Ce lien a expiré ou est invalide. Veuillez recommencer la demande de changement de courriel depuis votre profil.'
             : 'This link has expired or is invalid. Please restart the email change request from your profile.'));
    }

    try {
      // Re-verifier l'unicite du nouveau courriel au moment de l'application,
      // au cas ou un autre membre l'aurait pris entre la demande et la confirmation.
      const existing = await findByEmail(payload.newEmail);
      if (existing && existing.id !== payload.pageId) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(409).send(htmlPage(lang, false,
          isFr ? 'Ce courriel est désormais utilisé par un autre membre. Le changement ne peut pas être appliqué.'
               : 'This email is now used by another member. The change cannot be applied.'));
      }

      // Appliquer : email = newEmail, email2 = oldEmail (D.2)
      await updateProfile(payload.pageId, {
        email: payload.newEmail,
        email2: payload.oldEmail,
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(htmlPage(lang, true,
        isFr ? `Votre courriel principal est maintenant <strong>${payload.newEmail}</strong>. Votre ancien courriel <strong>${payload.oldEmail}</strong> a été conservé comme courriel secondaire.`
             : `Your primary email is now <strong>${payload.newEmail}</strong>. Your previous email <strong>${payload.oldEmail}</strong> has been kept as a secondary email.`));
    } catch (err) {
      console.error('Email change confirm error:', err);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(500).send(htmlPage(lang, false,
        isFr ? 'Erreur serveur. Veuillez réessayer plus tard.' : 'Server error. Please try again later.'));
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
