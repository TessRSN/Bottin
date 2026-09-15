/**
 * Campagne « complétez votre profil » (2026-09-15).
 *
 * Endpoint d'administration, protege par BACKUP_SECRET (?key=), GET ou POST.
 * Actions (?action=) :
 *   stats                         nombre de fiches restantes a contacter, par segment
 *   test&to=<courriel>            envoie le courriel a cette adresse, avec le lien
 *                                 de modification (30 jours) de la fiche qui porte ce
 *                                 courriel — pour verifier le rendu et le parcours
 *   send&segment=A|B|AB&limit=40&dryRun=1|0
 *                                 envoie aux prochaines fiches non contactees du ou
 *                                 des segments, dans l'ordre Regulier > Partenaire >
 *                                 Etudiant puis nom, marque la date d'envoi dans
 *                                 Notion (« Courriel campagne profil »). dryRun=1
 *                                 (defaut) : liste sans envoyer.
 *
 * Segments (decision Tess, 2026-09-15) :
 *   A = fiche approuvee sans decision de partage public (consentement vide)
 *   B = fiche publique (consentement Oui) sans statut, sans axe ou sans theme
 * Les refus (consentement Non) et les fiches non approuvees ne sont jamais contactes.
 *
 * Rythme : 40 par jour, choisi par Tess pour rester sous le plafond quotidien
 * de Resend avec les autres courriels du site. Resend accepte 2 requetes par
 * seconde : pause de 600 ms entre deux envois. Pas de cron (plafond Vercel
 * Hobby atteint) : declenchement manuel, ou a integrer a /api/export.
 */
const { getAllMembers, findByEmail, setMemberDate } = require('../lib/notion');
const { signCampaignToken } = require('../lib/token');
const { sendProfileCampaign } = require('../lib/email');

module.exports.config = { maxDuration: 60 };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPE_ORDER = { 'Régulier': 0, 'Partenaire': 1, 'Étudiant': 2 };

function segmentOf(m) {
  if (m.workflow !== 'Approuvé' || !m.email) return null;
  if (!m.consent) return 'A';
  if (m.consent === 'Oui' && (!m.statut || !m.axes.length || !m.themes)) return 'B';
  return null;
}

function editUrl(pageId, email) {
  const baseUrl = process.env.BASE_URL || 'https://bottin.rsn.quebec';
  return `${baseUrl}/edit.html?token=${signCampaignToken(pageId, email)}`;
}

function sortForSending(a, b) {
  const ta = TYPE_ORDER[a.type] ?? 9, tb = TYPE_ORDER[b.type] ?? 9;
  if (ta !== tb) return ta - tb;
  return `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr');
}

module.exports = async function handler(req, res) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const q = Object.assign({}, req.query || {}, body);
  if (!q.key || q.key !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const action = String(q.action || 'stats');

  try {
    if (action === 'test') {
      const to = String(q.to || '').trim().toLowerCase();
      if (!to) return res.status(400).json({ error: 'Parametre "to" requis' });
      const page = await findByEmail(to);
      if (!page) return res.status(404).json({ error: 'Aucune fiche pour ce courriel' });
      const prenom = page.properties['Prénom']?.title?.[0]?.plain_text || 'Membre';
      await sendProfileCampaign(to, prenom, editUrl(page.id, to));
      return res.status(200).json({ ok: true, sentTo: to, prenom, linkValidDays: 30 });
    }

    const members = await getAllMembers();
    const eligible = members.filter(m => segmentOf(m) && !m.campagneProfil);
    const counts = { A: 0, B: 0 };
    eligible.forEach(m => { counts[segmentOf(m)]++; });
    const alreadySent = members.filter(m => m.campagneProfil).length;

    if (action === 'stats') {
      return res.status(200).json({ ok: true, remaining: counts, alreadySent, total: eligible.length });
    }

    if (action === 'send') {
      const segment = String(q.segment || 'AB').toUpperCase();
      const wanted = segment === 'AB' ? ['A', 'B'] : [segment];
      const limit = Math.max(1, Math.min(parseInt(q.limit, 10) || 40, 100));
      const dryRun = !(q.dryRun === '0' || q.dryRun === 0 || q.dryRun === false || q.dryRun === 'false');
      const batch = eligible.filter(m => wanted.includes(segmentOf(m))).sort(sortForSending).slice(0, limit);
      const today = new Date().toISOString().slice(0, 10);
      const results = [];
      for (const m of batch) {
        const entry = { name: `${m.prenom} ${m.nom}`.trim(), email: m.email, segment: segmentOf(m), type: m.type };
        if (!dryRun) {
          try {
            await sendProfileCampaign(m.email, m.prenom || 'Membre', editUrl(m.id, m.email));
            await setMemberDate(m.id, 'campagneProfil', today);
            entry.sent = true;
          } catch (err) {
            entry.sent = false; entry.error = err.message;
            console.error('[campaign] echec pour', m.email, err.message);
          }
          await sleep(600);
        }
        results.push(entry);
      }
      const sent = results.filter(r => r.sent).length;
      return res.status(200).json({ ok: true, dryRun, segment, limit, selected: results.length, sent, remainingBefore: counts, results });
    }

    return res.status(400).json({ error: 'Action inconnue : ' + action });
  } catch (err) {
    console.error('[campaign] erreur :', err);
    return res.status(500).json({ error: err.message });
  }
};
