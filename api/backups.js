/**
 * GET /api/backups?action=manual|list|download&key=YOUR_SECRET[&filename=...]
 *
 * Regroupe les trois points d'entree d'administration des sauvegardes
 * (ex-backup-manual, list-backups, download-backup) en une seule fonction :
 * le plan Hobby de Vercel accepte au plus 12 fonctions serverless par
 * deploiement, et l'ajout du relais photo (api/photo.js) faisait 13.
 * Les anciennes adresses restent valides via les "rewrites" de vercel.json.
 * La sauvegarde automatique (cron) reste dans api/backup-auto.js.
 *
 *  - action=manual   : dump JSON complet de Notion en telechargement immediat
 *                      (rien n'est stocke dans Blob).
 *  - action=list     : liste des sauvegardes automatiques dans Vercel Blob,
 *                      { filename, url, size, sizeKB, uploadedAt }, plus recentes d'abord.
 *  - action=download : renvoie une sauvegarde Blob (filename obligatoire).
 *
 * Toutes protegees par BACKUP_SECRET (?key=).
 */
const { getAllMembers } = require('../lib/notion');
const { list, get } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const action = (req.query && req.query.action) || '';

  if (action === 'manual') return manualBackup(req, res);
  if (action === 'list') return listBackups(req, res);
  if (action === 'download') return downloadBackup(req, res);
  return res.status(400).json({ error: 'Unknown action', expected: ['manual', 'list', 'download'] });
};

module.exports.config = { maxDuration: 60 };

async function manualBackup(req, res) {
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
}

async function listBackups(req, res) {
  try {
    const { blobs } = await list({ prefix: 'backup-' });

    // Sort newest first
    blobs.sort(function(a, b) {
      return new Date(b.uploadedAt) - new Date(a.uploadedAt);
    });

    const items = blobs.map(function(b) {
      return {
        filename: b.pathname,
        url: b.url,
        size: b.size,
        sizeKB: Math.round(b.size / 1024 * 10) / 10,
        uploadedAt: b.uploadedAt,
      };
    });

    return res.status(200).json({
      count: items.length,
      backups: items,
    });
  } catch (err) {
    console.error('List backups error:', err);
    return res.status(500).json({ error: 'List failed', message: err.message });
  }
}

async function downloadBackup(req, res) {
  const filename = (req.query && req.query.filename) || '';
  if (!filename) {
    return res.status(400).json({ error: 'Missing filename parameter' });
  }

  try {
    const result = await get(filename, { access: 'private' });
    if (!result || result.statusCode !== 200) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    // Stream the blob content to the response
    const reader = result.stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    return res.end();
  } catch (err) {
    console.error('Download backup error:', err);
    return res.status(500).json({ error: 'Download failed', message: err.message });
  }
}
