/**
 * GET /api/download-backup?key=YOUR_SECRET&filename=backup-...json
 * Streams a private blob backup file back to the browser as a download.
 *
 * Use `/api/list-backups?key=...` first to get the exact filename.
 */
const { get } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  const providedKey = (req.query && req.query.key) || '';
  const filename = (req.query && req.query.filename) || '';

  if (!providedKey || providedKey !== process.env.BACKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
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
};

module.exports.config = { maxDuration: 60 };
