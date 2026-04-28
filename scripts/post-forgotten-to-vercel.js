#!/usr/bin/env node
/**
 * scripts/post-forgotten-to-vercel.js
 *
 * Script LOCAL pour recreer les ~36 membres oublies (presents dans le
 * CSV interne mais absents de Notion). Lit data/forgotten-members.js
 * (gitignored) et POST a /api/recreate-forgotten.
 *
 * Usage:
 *   BACKUP_SECRET=xxx node scripts/post-forgotten-to-vercel.js
 */
const path = require('path');

const SECRET = process.env.BACKUP_SECRET || process.argv[2];
const BASE_URL = process.env.BASE_URL || 'https://bottin-gamma.vercel.app';
const BATCH_SIZE = 30;

if (!SECRET) {
  console.error('Usage: BACKUP_SECRET=xxx node scripts/post-forgotten-to-vercel.js');
  process.exit(1);
}

let records;
try {
  records = require(path.resolve(__dirname, '..', 'data', 'forgotten-members.js'));
} catch (err) {
  console.error('Erreur: data/forgotten-members.js introuvable.');
  console.error('Ce fichier doit etre genere localement avant de lancer ce script.');
  process.exit(1);
}

console.log(`Lu ${records.length} oublies depuis data/forgotten-members.js`);
console.log(`POST vers ${BASE_URL}/api/recreate-forgotten...`);
console.log('');

const totals = { received: 0, created: 0, skippedExisting: 0, failed: 0, skippedReasons: [], errors: [] };

(async () => {
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(records.length / BATCH_SIZE);

    process.stdout.write(`Batch ${batchNum}/${totalBatches} (${batch.length} records)... `);

    const url = `${BASE_URL}/api/recreate-forgotten?key=${encodeURIComponent(SECRET)}`;
    let result;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: batch }),
      });
      result = await resp.json();
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(result)}`);
    } catch (err) {
      console.log('ECHEC');
      console.error(`  ${err.message}`);
      process.exit(1);
    }

    totals.received += result.received || 0;
    totals.created += result.created || 0;
    totals.skippedExisting += result.skippedExisting || 0;
    totals.failed += result.failed || 0;
    if (Array.isArray(result.skippedReasons)) totals.skippedReasons.push(...result.skippedReasons);
    if (Array.isArray(result.errors)) totals.errors.push(...result.errors);
    console.log(`created=${result.created} skipped=${result.skippedExisting} failed=${result.failed}`);
  }

  console.log('');
  console.log('=== Resume ===');
  console.log(`  Records envoyes:    ${totals.received}`);
  console.log(`  Fiches creees:      ${totals.created}`);
  console.log(`  Deja existantes:    ${totals.skippedExisting}`);
  console.log(`  Echecs:             ${totals.failed}`);
  if (totals.skippedReasons.length) {
    console.log('');
    console.log('Skippes:');
    for (const s of totals.skippedReasons) console.log(`  - ${s}`);
  }
  if (totals.errors.length) {
    console.log('');
    console.log('Erreurs:');
    for (const e of totals.errors) console.log(`  - ${JSON.stringify(e)}`);
  }
})();
