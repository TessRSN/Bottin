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
    <p style="font-size:0.9rem;color:#4a5568;background:#f7fafc;padding:0.75rem 1rem;border-left:3px solid #2b6cb0;border-radius:0.25rem">
      <strong>À noter :</strong> votre adhésion est valable <strong>2 ans</strong>. Quelques mois avant la fin de cette période, vous recevrez un courriel pour la renouveler en un clic. Sans renouvellement, votre profil sera automatiquement archivé.
    </p>
    <p>Pour toute question, n'hésitez pas à nous contacter à <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
    <p>Au plaisir,<br><strong>L'équipe du RSN</strong></p>

    <hr style="border:none;border-top:1px dashed #cbd5e0;margin:2rem 0">

    <p><strong>Hello ${name},</strong></p>
    <p>Good news! Your profile has been approved and is now visible in the RSN public directory.</p>
    <div style="text-align:center;margin:2rem 0">
      <a href="${BOTTIN_URL}" style="${btnStyle}">View the directory</a>
    </div>
    <p>You can update your profile at any time by requesting a secure link via the <a href="${BOTTIN_URL}/magic-link.html">My profile page</a>.</p>
    <p style="font-size:0.9rem;color:#4a5568;background:#f7fafc;padding:0.75rem 1rem;border-left:3px solid #2b6cb0;border-radius:0.25rem">
      <strong>Note:</strong> your membership is valid for <strong>2 years</strong>. A few months before the end of this period, you will receive an email to renew it in one click. Without renewal, your profile will be automatically archived.
    </p>
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

/**
 * Helper: format an ISO date (YYYY-MM-DD) into a French long form.
 *   "2026-11-24" -> "24 novembre 2026"
 */
function frDate(iso) {
  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '';
  return `${parseInt(m[3], 10)} ${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

function enDate(iso) {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '';
  return `${months[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}, ${m[1]}`;
}

const renewBtnStyle = 'display:inline-block;padding:0.75rem 2rem;background:#2b6cb0;color:#ffffff;text-decoration:none;border-radius:0.5rem;font-weight:600;font-size:1rem';

/**
 * Email 1 - sent 60 days before membership expiry.
 */
async function sendRenewalReminder60j(to, name, dateRenouvISO, renewUrl) {
  const subject = 'RSN — Votre adhésion arrive à échéance / Your membership is expiring';
  const inner = `
    <p><strong>Bonjour ${name},</strong></p>
    <p>Votre adhésion au Réseau de santé numérique arrive à échéance le <strong>${frDate(dateRenouvISO)}</strong>, soit dans environ <strong>2 mois</strong>.</p>
    <p>Pour continuer à figurer dans le bottin du RSN et recevoir nos communications, merci de renouveler votre adhésion :</p>
    <div style="text-align:center;margin:2rem 0">
      <a href="${renewUrl}" style="${renewBtnStyle}">Renouveler mon adhésion</a>
    </div>
    <p>Si vous ne souhaitez plus faire partie du RSN, aucune action n'est requise — votre profil sera archivé à l'échéance.</p>
    <p>Pour toute question : <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
    <p>Au plaisir,<br><strong>L'équipe du RSN</strong></p>

    <hr style="border:none;border-top:1px dashed #cbd5e0;margin:2rem 0">

    <p><strong>Hello ${name},</strong></p>
    <p>Your membership in the Réseau de santé numérique expires on <strong>${enDate(dateRenouvISO)}</strong>, in about <strong>2 months</strong>.</p>
    <p>To remain in the RSN directory and continue receiving our communications, please renew your membership:</p>
    <div style="text-align:center;margin:2rem 0">
      <a href="${renewUrl}" style="${renewBtnStyle}">Renew my membership</a>
    </div>
    <p>If you no longer wish to be part of the RSN, no action is required — your profile will be archived at the expiry date.</p>
    <p>For any questions: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
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
 * Email 2 - reminder sent 30 days before expiry (if no renewal yet).
 */
async function sendRenewalReminder30j(to, name, dateRenouvISO, renewUrl) {
  const subject = 'RSN — Rappel : votre adhésion expire bientôt / Reminder: your membership expires soon';
  const inner = `
    <p><strong>Bonjour ${name},</strong></p>
    <p>Votre adhésion au RSN expire le <strong>${frDate(dateRenouvISO)}</strong> (dans 1 mois). Vous n'avez pas encore renouvelé.</p>
    <div style="text-align:center;margin:2rem 0">
      <a href="${renewUrl}" style="${renewBtnStyle}">Renouveler mon adhésion</a>
    </div>
    <p>Sans réponse de votre part d'ici l'échéance, votre profil sera archivé.</p>
    <p>Au plaisir,<br><strong>L'équipe du RSN</strong></p>

    <hr style="border:none;border-top:1px dashed #cbd5e0;margin:2rem 0">

    <p><strong>Hello ${name},</strong></p>
    <p>Your RSN membership expires on <strong>${enDate(dateRenouvISO)}</strong> (in 1 month). You haven't renewed yet.</p>
    <div style="text-align:center;margin:2rem 0">
      <a href="${renewUrl}" style="${renewBtnStyle}">Renew my membership</a>
    </div>
    <p>Without action on your part by the expiry date, your profile will be archived.</p>
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
 * Email 3 - confirmation after the member clicks "Renew" on /renew.html.
 */
async function sendRenewalConfirmation(to, name, newDateRenouvISO) {
  const subject = 'RSN — Adhésion renouvelée / Membership renewed';
  const inner = `
    <p><strong>Bonjour ${name},</strong></p>
    <p>Merci ! Votre adhésion au RSN est renouvelée jusqu'au <strong>${frDate(newDateRenouvISO)}</strong>. Vous restez visible dans le bottin et continuerez à recevoir nos communications.</p>
    <p>Au plaisir,<br><strong>L'équipe du RSN</strong></p>

    <hr style="border:none;border-top:1px dashed #cbd5e0;margin:2rem 0">

    <p><strong>Hello ${name},</strong></p>
    <p>Thank you! Your RSN membership is renewed until <strong>${enDate(newDateRenouvISO)}</strong>. You remain in the directory and will continue to receive our communications.</p>
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
 * Email 4 - sent on archival day to inform the member their profile
 * was archived because they didn't renew.
 */
async function sendArchiveNotification(to, name) {
  const subject = 'RSN — Votre profil a été archivé / Your profile has been archived';
  const inner = `
    <p><strong>Bonjour ${name},</strong></p>
    <p>Faute de renouvellement, votre profil RSN a été archivé aujourd'hui. Vos données seront définitivement supprimées dans les 30 jours.</p>
    <p>Vous pouvez vous réinscrire à tout moment via le formulaire d'inscription : <a href="${BOTTIN_URL}/join.html">${BOTTIN_URL}/join.html</a></p>
    <p>Au plaisir,<br><strong>L'équipe du RSN</strong></p>

    <hr style="border:none;border-top:1px dashed #cbd5e0;margin:2rem 0">

    <p><strong>Hello ${name},</strong></p>
    <p>Without a renewal, your RSN profile was archived today. Your data will be permanently deleted within 30 days.</p>
    <p>You can re-register anytime via the registration form: <a href="${BOTTIN_URL}/join.html">${BOTTIN_URL}/join.html</a></p>
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
 * Email 5 - daily admin summary of fiches that will be archived in the
 * next 7 days. Sent only when at least one fiche is upcoming.
 * Recipients come from process.env.ADMIN_NOTIFICATION_RECIPIENTS.
 * No Reply-To override here.
 */
async function sendAdminRetentionRecap(recipients, upcomingList) {
  if (!recipients || recipients.length === 0) return;
  if (!upcomingList || upcomingList.length === 0) return;

  const n = upcomingList.length;
  const subject = `RSN Admin — ${n} fiche${n>1?'s':''} sera${n>1?'ont':''} archivée${n>1?'s':''} dans 7 jours / ${n} profile${n>1?'s':''} to be archived within 7 days`;

  const frList = upcomingList.map(m => `<li>${m.name} (${m.email}) — échéance ${frDate(m.dateRenouvellement)}</li>`).join('');
  const enList = upcomingList.map(m => `<li>${m.name} (${m.email}) — expires ${enDate(m.dateRenouvellement)}</li>`).join('');

  const inner = `
    <p><strong>Bonjour,</strong></p>
    <p>Voici la liste des <strong>${n} fiche${n>1?'s':''}</strong> qui ${n>1?'seront':'sera'} automatiquement archivée${n>1?'s':''} dans les 7 prochains jours faute de renouvellement :</p>
    <ul>${frList}</ul>
    <p>Si vous souhaitez relancer manuellement l'une de ces personnes, c'est le moment.</p>

    <hr style="border:none;border-top:1px dashed #cbd5e0;margin:2rem 0">

    <p><strong>Hello,</strong></p>
    <p>Here ${n>1?'are':'is'} the <strong>${n} profile${n>1?'s':''}</strong> that will be automatically archived within the next 7 days due to non-renewal:</p>
    <ul>${enList}</ul>
    <p>If you wish to follow up manually with any of these members, now is the time.</p>
  `;

  await getTransporter().sendMail({
    from: `RSN Bottin <${process.env.GMAIL_USER}>`,
    to: recipients.join(', '),
    subject,
    html: emailWrapper(inner),
  });
}

module.exports = {
  sendMagicLink, sendJoinConfirmation, sendAcceptanceEmail,
  sendRenewalReminder60j, sendRenewalReminder30j, sendRenewalConfirmation,
  sendArchiveNotification, sendAdminRetentionRecap,
};
