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
 *
 * Phase 2h (2026-05-04): le courriel est enrichi pour montrer les 3 types
 * d'adhesion (Regulier / Etudiant / Partenaire) avec leurs privileges
 * respectifs, et un bandeau en haut indique le type actuel du membre.
 * Si la personne change de type plus tard, elle a deja toute l'info
 * dans son courriel d'accueil — pas besoin d'en renvoyer un nouveau.
 */
const RSN_WEBSITE_FR = 'https://rsn.quebec/';
const RSN_WEBSITE_EN = 'https://rsn.quebec/en/';
const RSN_LINKEDIN = 'https://www.linkedin.com/company/r%C3%A9seau-sant%C3%A9-num%C3%A9rique/';

// Privileges par type d'adhesion. Source: templates Mailchimp valides
// par Tess + collegues (2026-05-04). Etudiant et partenaire ont
// actuellement la meme liste — sera differencie ulterieurement si la
// collegue de Tess revient avec une distinction metier.
const PRIVILEGES_FR = {
  regulier: [
    "le droit de vote à l'assemblée générale des membres du réseau ;",
    "la possibilité d'accéder aux fonctions administratives des différents axes et thèmes du réseau, par exemple en devenant responsable d'un axe ou d'une thématique ;",
    "l'occasion de soumettre une demande de financement comme chercheuse ou chercheur principal pour des projets conformes à notre mission et à nos objectifs ;",
    "l'occasion de partager vos travaux, échanger des idées et participer à des projets collaboratifs ;",
    "l'accès aux événements organisés par les membres, aux événements commandités par le RSN, aux ateliers à venir, ainsi qu'une invitation à notre conférence scientifique annuelle.",
  ],
  etudiant: [
    "la possibilité d'accéder aux fonctions administratives ;",
    "l'occasion de partager vos travaux, échanger des idées et participer à des projets collaboratifs ;",
    "l'accès aux événements organisés par les membres, aux événements commandités par le RSN, aux ateliers à venir, ainsi qu'une invitation à notre conférence scientifique annuelle.",
  ],
  partenaire: [
    "la possibilité d'accéder aux fonctions administratives ;",
    "l'occasion de partager vos travaux, échanger des idées et participer à des projets collaboratifs ;",
    "l'accès aux événements organisés par les membres, aux événements commandités par le RSN, aux ateliers à venir, ainsi qu'une invitation à notre conférence scientifique annuelle.",
  ],
};
const PRIVILEGES_EN = {
  regulier: [
    "voting rights at the annual Members' General meeting;",
    "the possibility of accessing administrative roles within the different axes and themes of the network, for example by becoming a leader for an axis or theme;",
    "the opportunity to apply for funding as a principal investigator for projects that align with our mission and objectives;",
    "the opportunity to share your work, exchange ideas and engage in collaborative projects;",
    "access to member-organized events, RSN sponsored events, workshops, and an invitation to our annual scientific conference.",
  ],
  etudiant: [
    "the possibility of accessing administrative roles;",
    "the opportunity to share your work, exchange ideas and engage in collaborative projects;",
    "access to member-organized events, RSN sponsored events, workshops, and an invitation to our annual scientific conference.",
  ],
  partenaire: [
    "the possibility of accessing administrative roles;",
    "the opportunity to share your work, exchange ideas and engage in collaborative projects;",
    "access to member-organized events, RSN sponsored events, workshops, and an invitation to our annual scientific conference.",
  ],
};

function typeKey(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('régulier') || t.includes('regulier')) return 'regulier';
  if (t.includes('étudiant') || t.includes('etudiant')) return 'etudiant';
  if (t.includes('partenaire') || t.includes('partner')) return 'partenaire';
  return null;
}
function typeLabelFR(key) {
  if (key === 'regulier') return 'membre régulier';
  if (key === 'etudiant') return 'membre étudiant·e';
  if (key === 'partenaire') return 'membre partenaire';
  return 'membre';
}
function typeLabelEN(key) {
  if (key === 'regulier') return 'Regular member';
  if (key === 'etudiant') return 'Student member';
  if (key === 'partenaire') return 'Partner member';
  return 'Member';
}

function privilegesSectionFR(currentKey) {
  const sections = ['regulier', 'etudiant', 'partenaire'].map(k => {
    const isCurrent = k === currentKey;
    const heading = `À titre de ${typeLabelFR(k)}${isCurrent ? ' <span style="font-size:0.8rem;color:#2b6cb0;font-weight:600">— votre type actuel</span>' : ''}`;
    const items = PRIVILEGES_FR[k].map(p => `<li style="margin-bottom:0.4rem">${p}</li>`).join('');
    const bg = isCurrent ? 'background:#ebf8ff;padding:1rem 1.25rem;border-left:3px solid #2b6cb0;border-radius:0.25rem;' : '';
    return `<div style="${bg}margin-bottom:1.5rem"><p style="margin-bottom:0.5rem;font-weight:700;color:#1a365d">${heading}</p><p style="margin-top:0;margin-bottom:0.5rem">Vous bénéficiez notamment de :</p><ul style="margin-top:0;padding-left:1.25rem">${items}</ul></div>`;
  });
  return sections.join('');
}
function privilegesSectionEN(currentKey) {
  const sections = ['regulier', 'etudiant', 'partenaire'].map(k => {
    const isCurrent = k === currentKey;
    const heading = `As a ${typeLabelEN(k)}${isCurrent ? ' <span style="font-size:0.8rem;color:#2b6cb0;font-weight:600">— your current type</span>' : ''}`;
    const items = PRIVILEGES_EN[k].map(p => `<li style="margin-bottom:0.4rem">${p}</li>`).join('');
    const bg = isCurrent ? 'background:#ebf8ff;padding:1rem 1.25rem;border-left:3px solid #2b6cb0;border-radius:0.25rem;' : '';
    return `<div style="${bg}margin-bottom:1.5rem"><p style="margin-bottom:0.5rem;font-weight:700;color:#1a365d">${heading}</p><p style="margin-top:0;margin-bottom:0.5rem">You will benefit from:</p><ul style="margin-top:0;padding-left:1.25rem">${items}</ul></div>`;
  });
  return sections.join('');
}

async function sendAcceptanceEmail(to, name, type) {
  const subject = 'RSN — Bienvenue ! Votre profil est en ligne / Welcome! Your profile is live';
  const btnStyle = 'display:inline-block;padding:0.75rem 2rem;background:#2b6cb0;color:#ffffff;text-decoration:none;border-radius:0.5rem;font-weight:600;font-size:1rem';

  const key = typeKey(type);
  const currentTypeFR = key ? typeLabelFR(key) : 'membre';
  const currentTypeEN = key ? typeLabelEN(key).toLowerCase() : 'member';

  const inner = `
    <p style="text-align:center;color:#718096;font-size:0.85rem;margin-bottom:1.5rem;font-style:italic">English version below ↓</p>

    <p><strong>Bonjour ${name},</strong></p>
    <p>Bienvenue au Réseau santé numérique (RSN) ! Nous sommes ravi·es de vous accueillir au sein de notre réseau dynamique qui regroupe des membres issus de diverses institutions et disciplines, tous engagé·es pour la recherche en santé numérique.</p>
    <p>Bonne nouvelle : votre profil a été approuvé et est maintenant visible dans le bottin public du RSN. Vous y êtes inscrit·e comme <strong>${currentTypeFR}</strong>.</p>

    <div style="text-align:center;margin:1.5rem 0">
      <a href="${BOTTIN_URL}" style="${btnStyle}">Consulter le bottin</a>
    </div>

    <h3 style="color:#2b6cb0;margin-top:2rem;margin-bottom:1rem;font-size:1rem">Vos droits selon le type d'adhésion</h3>
    <p style="font-size:0.9rem;color:#4a5568">Voici un résumé des privilèges associés à chaque type d'adhésion au sein du RSN. Votre type actuel est mis en évidence ; les autres sont indiqués pour information (vous pouvez changer de type via votre profil si votre situation évolue).</p>

    ${privilegesSectionFR(key)}

    <h3 style="color:#2b6cb0;margin-top:2rem;margin-bottom:0.5rem;font-size:1rem">Communication</h3>
    <p>En adhérant au RSN, vous consentez à recevoir nos communications par courriel ainsi que notre infolettre, qui comprennent des informations importantes sur nos activités, initiatives et événements.</p>

    <h3 style="color:#2b6cb0;margin-top:2rem;margin-bottom:0.5rem;font-size:1rem">Modifier votre profil</h3>
    <p>Vous pouvez modifier votre profil à tout moment en demandant un lien sécurisé via la <a href="${BOTTIN_URL}/magic-link.html">page Mon profil</a>.</p>

    <p style="font-size:0.9rem;color:#4a5568;background:#f7fafc;padding:0.75rem 1rem;border-left:3px solid #2b6cb0;border-radius:0.25rem;margin-top:1.5rem">
      <strong>À noter :</strong> votre adhésion est valable <strong>2 ans</strong>. Quelques mois avant la fin de cette période, vous recevrez un courriel pour la renouveler en un clic. Sans renouvellement, votre profil sera automatiquement archivé.
    </p>

    <p style="margin-top:1.5rem">Pour en savoir plus sur le RSN et nos activités, visitez notre <a href="${RSN_WEBSITE_FR}">site web</a> et suivez-nous sur <a href="${RSN_LINKEDIN}">LinkedIn</a>.</p>
    <p>Pour toute question, n'hésitez pas à nous écrire à <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
    <p>Au plaisir,<br><strong>L'équipe du RSN</strong></p>

    <hr style="border:none;border-top:1px dashed #cbd5e0;margin:2rem 0">

    <p><strong>Hello ${name},</strong></p>
    <p>Welcome to the Digital Health Network (RSN)! We are delighted to welcome you to our vibrant network of members from various institutions and disciplines, all committed to digital health research.</p>
    <p>Good news: your profile has been approved and is now visible in the RSN public directory. You are registered as a <strong>${currentTypeEN}</strong>.</p>

    <div style="text-align:center;margin:1.5rem 0">
      <a href="${BOTTIN_URL}" style="${btnStyle}">View the directory</a>
    </div>

    <h3 style="color:#2b6cb0;margin-top:2rem;margin-bottom:1rem;font-size:1rem">Your rights by membership type</h3>
    <p style="font-size:0.9rem;color:#4a5568">Here is a summary of the privileges associated with each membership type at the RSN. Your current type is highlighted; the others are listed for information (you can change your type via your profile if your situation evolves).</p>

    ${privilegesSectionEN(key)}

    <h3 style="color:#2b6cb0;margin-top:2rem;margin-bottom:0.5rem;font-size:1rem">Communication</h3>
    <p>By becoming a member of the RSN, you consent to receiving our email communications, including our newsletter, in order to stay informed about our activities, initiatives, and events.</p>

    <h3 style="color:#2b6cb0;margin-top:2rem;margin-bottom:0.5rem;font-size:1rem">Update your profile</h3>
    <p>You can update your profile at any time by requesting a secure link via the <a href="${BOTTIN_URL}/magic-link.html">My profile page</a>.</p>

    <p style="font-size:0.9rem;color:#4a5568;background:#f7fafc;padding:0.75rem 1rem;border-left:3px solid #2b6cb0;border-radius:0.25rem;margin-top:1.5rem">
      <strong>Note:</strong> your membership is valid for <strong>2 years</strong>. A few months before the end of this period, you will receive an email to renew it in one click. Without renewal, your profile will be automatically archived.
    </p>

    <p style="margin-top:1.5rem">To learn more about the RSN and our activities, visit our <a href="${RSN_WEBSITE_EN}">website</a> and follow us on <a href="${RSN_LINKEDIN}">LinkedIn</a>.</p>
    <p>For any questions, feel free to write to us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
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

/**
 * Phase 2b (2026-05-04) — confirmation pour changement de courriel principal.
 * Le lien est envoye au NOUVEAU courriel (pour prouver l'acces) ; sur clic,
 * le swap est applique : email = newEmail, email2 = ancien email.
 * Si la personne avait deja un secondaire, la confirmation cote front
 * a deja averti que l'ancien secondaire serait remplace (decision D.2).
 */
async function sendEmailChangeConfirmation(toNewEmail, name, confirmUrl, oldEmail, lang) {
  const isFr = (lang || 'fr') === 'fr';

  const subject = isFr
    ? 'RSN — Confirmer votre nouveau courriel'
    : 'RSN — Confirm your new email address';

  const inner = `
    <p>${isFr ? `Bonjour ${name},` : `Hello ${name},`}</p>

    <p>${isFr
      ? `Vous avez demandé à changer votre courriel principal du Réseau de santé numérique de <strong>${oldEmail}</strong> vers cette adresse.`
      : `You requested to change your primary email for the Digital Health Network from <strong>${oldEmail}</strong> to this address.`
    }</p>

    <p>${isFr
      ? 'Cliquez sur le bouton ci-dessous pour confirmer le changement :'
      : 'Click the button below to confirm the change:'
    }</p>

    <div style="text-align:center;margin:2rem 0">
      <a href="${confirmUrl}" style="display:inline-block;padding:0.75rem 2rem;background:#2b6cb0;color:#ffffff;text-decoration:none;border-radius:0.5rem;font-weight:600;font-size:1rem">
        ${isFr ? 'Confirmer le changement' : 'Confirm the change'}
      </a>
    </div>

    <p style="font-size:0.85rem;color:#718096">
      ${isFr
        ? `Une fois confirmé, votre courriel principal deviendra <strong>${toNewEmail}</strong> et votre ancien courriel <strong>${oldEmail}</strong> sera conservé comme courriel secondaire.`
        : `Once confirmed, your primary email will become <strong>${toNewEmail}</strong> and your previous email <strong>${oldEmail}</strong> will be kept as a secondary email.`
      }
    </p>

    <p style="font-size:0.85rem;color:#718096">
      ${isFr
        ? "Ce lien est valide pendant 1 heure. Si vous n'avez pas fait cette demande, ignorez ce courriel — votre courriel principal restera inchangé."
        : 'This link is valid for 1 hour. If you did not request this change, ignore this email — your primary email will remain unchanged.'
      }
    </p>
  `;

  await getTransporter().sendMail({
    from: `RSN Bottin <${process.env.GMAIL_USER}>`,
    replyTo: REPLY_TO,
    to: toNewEmail,
    subject,
    html: emailWrapper(inner),
  });
}

module.exports = {
  sendMagicLink, sendJoinConfirmation, sendAcceptanceEmail,
  sendEmailChangeConfirmation,
  sendRenewalReminder60j, sendRenewalReminder30j, sendRenewalConfirmation,
  sendArchiveNotification, sendAdminRetentionRecap,
};
