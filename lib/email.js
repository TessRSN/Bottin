/**
 * Send transactional emails via Gmail SMTP (Nodemailer)
 *
 * - sendMagicLink: lien sécurisé pour modifier son profil (1h)
 * - sendJoinConfirmation: confirmation de soumission du formulaire d'inscription
 * - sendAcceptanceEmail: notification quand un profil est approuvé et publié
 *
 * Tous les emails ont Reply-To: rsn.gestion@rimuhc.ca pour rediriger
 * les réponses vers l'équipe RSN même si l'expéditeur technique est Gmail.
 */
const nodemailer = require('nodemailer');

const REPLY_TO = 'rsn.gestion@rimuhc.ca';
const CONTACT_EMAIL = 'rsn.gestion@rimuhc.ca';
const BOTTIN_URL = process.env.BASE_URL || 'https://bottin-gamma.vercel.app';

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

function emailWrapper(innerHtml) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:2rem;color:#1a202c">
      <div style="text-align:center;margin-bottom:1.5rem">
        <h2 style="color:#2b6cb0;margin:0">Réseau de santé numérique</h2>
      </div>
      ${innerHtml}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:1.5rem 0">
      <p style="font-size:0.75rem;color:#a0aec0;text-align:center">
        Réseau de santé numérique (RSN) — <a href="mailto:${CONTACT_EMAIL}" style="color:#a0aec0">${CONTACT_EMAIL}</a>
      </p>
    </div>
  `;
}

/**
 * Send a magic link email (existing functionality)
 */
async function sendMagicLink(to, name, magicUrl, lang = 'fr') {
  const isFr = lang === 'fr';

  const subject = isFr
    ? 'RSN — Modifier votre profil de membre'
    : 'RSN — Update your member profile';

  const inner = `
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
  `;

  await getTransporter().sendMail({
    from: `RSN Bottin <${process.env.GMAIL_USER}>`,
    replyTo: REPLY_TO,
    to,
    subject,
    html: emailWrapper(inner),
  });
}

/**
 * Send a confirmation email after a new member submits the join form.
 * Bilingue (FR + EN).
 */
async function sendJoinConfirmation(to, name) {
  const subject = 'RSN — Profil reçu / Profile received';

  const inner = `
    <p><strong>Bonjour ${name},</strong></p>
    <p>Merci d'avoir soumis votre profil au bottin du Réseau de santé numérique. Nous l'avons bien reçu.</p>
    <p>Votre fiche sera examinée par notre équipe dans les <strong>2 prochaines semaines</strong>. Vous recevrez un autre courriel dès qu'elle sera publiée dans le bottin public.</p>
    <p>Si vous avez des questions ou souhaitez modifier votre soumission, vous pouvez nous joindre à <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
    <p>Au plaisir,<br><strong>L'équipe du RSN</strong></p>

    <hr style="border:none;border-top:1px dashed #cbd5e0;margin:2rem 0">

    <p><strong>Hello ${name},</strong></p>
    <p>Thank you for submitting your profile to the Réseau de santé numérique directory. We have received it.</p>
    <p>Your profile will be reviewed by our team within the <strong>next 2 weeks</strong>. You will receive another email as soon as it has been published in the public directory.</p>
    <p>If you have any questions or wish to amend your submission, please contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
    <p>Best regards,<br><strong>The RSN team</strong></p>
  `;

  await getTransporter().sendMail({
    from: `RSN Bottin <${process.env.GMAIL_USER}>`,
    replyTo: REPLY_TO,
    to,
    subject,
    html: emailWrapper(inner),
  });
}

/**
 * Send an acceptance email when a member's profile has been approved
 * and is now visible in the public directory.
 * Bilingue (FR + EN).
 */
async function sendAcceptanceEmail(to, name) {
  const subject = 'RSN — Votre profil est en ligne ! / Your profile is now live!';

  const btnStyle = 'display:inline-block;padding:0.75rem 2rem;background:#2b6cb0;color:#ffffff;text-decoration:none;border-radius:0.5rem;font-weight:600;font-size:1rem';

  const inner = `
    <p><strong>Bonjour ${name},</strong></p>
    <p>Bonne nouvelle ! Votre profil a été approuvé et est maintenant visible dans le bottin public du RSN.</p>
    <div style="text-align:center;margin:2rem 0">
      <a href="${BOTTIN_URL}" style="${btnStyle}">Consulter le bottin</a>
    </div>
    <p>Vous pouvez modifier votre profil à tout moment en demandant un lien sécurisé via la <a href="${BOTTIN_URL}/magic-link.html">page Mon profil</a>.</p>
    <p>Pour toute question, n'hésitez pas à nous contacter à <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
    <p>Au plaisir,<br><strong>L'équipe du RSN</strong></p>

    <hr style="border:none;border-top:1px dashed #cbd5e0;margin:2rem 0">

    <p><strong>Hello ${name},</strong></p>
    <p>Good news! Your profile has been approved and is now visible in the RSN public directory.</p>
    <div style="text-align:center;margin:2rem 0">
      <a href="${BOTTIN_URL}" style="${btnStyle}">View the directory</a>
    </div>
    <p>You can update your profile at any time by requesting a secure link via the <a href="${BOTTIN_URL}/magic-link.html">My profile page</a>.</p>
    <p>For any questions, feel free to contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
    <p>Best regards,<br><strong>The RSN team</strong></p>
  `;

  await getTransporter().sendMail({
    from: `RSN Bottin <${process.env.GMAIL_USER}>`,
    replyTo: REPLY_TO,
    to,
    subject,
    html: emailWrapper(inner),
  });
}

module.exports = { sendMagicLink, sendJoinConfirmation, sendAcceptanceEmail };
