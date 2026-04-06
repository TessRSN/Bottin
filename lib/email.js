/**
 * Send magic link emails via Gmail SMTP (Nodemailer)
 */
const nodemailer = require('nodemailer');

let _transporter;
function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return _transporter;
}

/**
 * Send a magic link email to a member
 * @param {string} to - recipient email
 * @param {string} name - member's name
 * @param {string} magicUrl - full URL with token
 * @param {string} lang - 'fr' or 'en'
 */
async function sendMagicLink(to, name, magicUrl, lang = 'fr') {
  const isFr = lang === 'fr';

  const subject = isFr
    ? 'RSN — Modifier votre profil de membre'
    : 'RSN — Update your member profile';

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:500px;margin:0 auto;padding:2rem;color:#1a202c">
      <div style="text-align:center;margin-bottom:1.5rem">
        <h2 style="color:#2b6cb0;margin:0">Réseau de santé numérique</h2>
      </div>

      <p>${isFr ? `Bonjour ${name},` : `Hello ${name},`}</p>

      <p>${isFr
        ? 'Vous avez demandé à modifier votre profil de membre du RSN. Cliquez sur le bouton ci-dessous pour accéder à votre formulaire de modification :'
        : 'You requested to update your RSN member profile. Click the button below to access your edit form:'
      }</p>

      <div style="text-align:center;margin:2rem 0">
        <a href="${magicUrl}" style="display:inline-block;padding:0.75rem 2rem;background:#2b6cb0;color:#ffffff;text-decoration:none;border-radius:0.5rem;font-weight:600;font-size:1rem">
          ${isFr ? 'Modifier mon profil' : 'Edit my profile'}
        </a>
      </div>

      <p style="font-size:0.85rem;color:#718096">
        ${isFr
          ? 'Ce lien est valide pendant 1 heure. Si vous n\'avez pas fait cette demande, ignorez cet email.'
          : 'This link is valid for 1 hour. If you did not make this request, please ignore this email.'
        }
      </p>

      <hr style="border:none;border-top:1px solid #e2e8f0;margin:1.5rem 0">
      <p style="font-size:0.75rem;color:#a0aec0;text-align:center">
        Réseau de santé numérique (RSN) — rsn.ca
      </p>
    </div>
  `;

  await getTransporter().sendMail({
    from: `RSN Bottin <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
  });
}

module.exports = { sendMagicLink };
