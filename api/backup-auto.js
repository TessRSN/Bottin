/**
 * GET /api/backup-auto
 * Triggered by weekly Vercel cron (see vercel.json).
 * Dumps the entire Notion database as JSON and saves it to Vercel Blob Storage.
 *
 * Protected against direct invocation: only Vercel cron (with CRON_SECRET header)
 * or requests with BACKUP_SECRET can trigger a backup.
 */
const { getAllMembers } = require('../lib/notion');
const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  // Vercel cron sends an authorization header with the project's CRON_SECRET
  // (only if the env var is set on the project — we require it here).
  // For manual triggers (testing), also accept BACKUP_SECRET as a query param.
  const authHeader = req.headers['authorization'] || '';
  const providedKey = (req.query && req.query.key) || '';
  const cronSecret = process.env.CRON_SECRET;
  const backupSecret = process.env.BACKUP_SECRET;

  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isManual = backupSecret && providedKey === backupSecret;

  if (!isCron && !isManual) {
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

    const json = JSON.stringify(payload, null, 2);

    // Timestamped filename: backup-2026-04-19T03-00-00-000Z.json
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.json`;

    const blob = await put(filename, json, {
      access: 'private', // private store — content only accessible with the BLOB_READ_WRITE_TOKEN
      contentType: 'application/json',
      addRandomSuffix: true,
    });

    return res.status(200).json({
      ok: true,
      filename: filename,
      size: json.length,
      memberCount: members.length,
      url: blob.url,
    });
  } catch (err) {
    console.error('Backup error:', err);
    return res.status(500).json({ error: 'Backup failed', message: err.message });
  }
};

module.exports.config = { maxDuration: 60 };
