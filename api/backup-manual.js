/**
 * GET /api/backup-manual?key=YOUR_SECRET
 * Protected endpoint that returns a full JSON backup as an instant download.
 *
 * Usage: open the URL in a browser with ?key=YOUR_BACKUP_SECRET
 * The browser will download a file like `rsn-backup-2026-04-14.json`.
 * Nothing is stored in Blob — this is a one-shot on-demand export.
 */
const { getAllMembers } = require('../lib/notion');

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const members = await getAllMembers();

    const payload = {
      backupDate: new Date().toISOString(),
      memberCount: members.length,
      schemaVersion: 1,
      source: 'Notion DB',
      members: members,
    };

    const dateOnly = new Date().toISOString().slice(0, 10);
    const filename = `rsn-backup-${dateOnly}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error('Manual backup error:', err);
    return res.status(500).json({ error: 'Backup failed', message: err.message });
  }
};

module.exports.config = { maxDuration: 60 };
