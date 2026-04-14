/**
 * GET /api/list-backups?key=YOUR_SECRET
 * Lists all automatic backups stored in Vercel Blob Storage.
 *
 * Returns a JSON array of { filename, url, size, uploadedAt }, newest first.
 * The URL can be pasted in a browser to download that specific backup.
 */
const { list } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
};

module.exports.config = { maxDuration: 30 };
