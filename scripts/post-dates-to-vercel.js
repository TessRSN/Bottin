#!/usr/bin/env node
/**
 * scripts/post-dates-to-vercel.js
 *
 * Script LOCAL à lancer depuis la machine de l'admin pour importer les
 * dates d'adhésion historiques vers Vercel/Notion.
 *
 * Le fichier data/membership-dates.js (qui contient les emails) est
 * gitignored — il reste uniquement sur la machine de l'admin.
 *
 * Usage:
 *   node scripts/post-dates-to-vercel.js
 *
 * Variables d'environnement requises:
 *   BACKUP_SECRET = clé secrète configurée sur Vercel (utilisée aussi
 *                   pour les autres endpoints admin)
 *
 *   ou en argument: node scripts/post-dates-to-vercel.js <secret>
 *
 * Ce script:
 *   1. Lit data/membership-dates.js localement
 *   2. POST vers /api/import-dates par batches de 100 (pour éviter
 *      les timeouts Vercel)
 *   3. Affiche les résultats agrégés
 */
const path = require('path');

const SECRET = process.env.BACKUP_SECRET || process.argv[2];
const BASE_URL = process.env.BASE_URL || 'https://bottin.rsn.quebec';
const BATCH_SIZE = 100;

if (!SECRET) {
  console.error('Erreur: BACKUP_SECRET manquant.');
  console.error('Lancez avec:  BACKUP_SECRET=xxx node scripts/post-dates-to-vercel.js');
  console.error('         ou:  node scripts/post-dates-to-vercel.js <secret>');
  process.exit(1);
}

let records;
try {
  records = require(path.resolve(__dirname, '..', 'data', 'membership-dates.js'));
} catch (err) {
  console.error('Erreur: data/membership-dates.js introuvable.');
  console.error('Ce fichier est gitignored — il devrait exister localement après extraction du CSV.');
  console.error('Détail:', err.message);
  process.exit(1);
}

if (!Array.isArray(records) || records.length === 0) {
  console.error('Erreur: data/membership-dates.js ne contient pas un tableau valide.');
  process.exit(1);
}

console.log(`Lu ${records.length} records depuis data/membership-dates.js`);
console.log(`Envoi vers ${BASE_URL}/api/import-dates par batches de ${BATCH_SIZE}...`);
console.log('');

const totals = { received: 0, updated: 0, notFound: 0, failed: 0, notFoundEmails: [] };

(async () => {
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(records.length / BATCH_SIZE);

    process.stdout.write(`Batch ${batchNum}/${totalBatches} (${batch.length} records)... `);

    const url = `${BASE_URL}/api/import-dates?key=${encodeURIComponent(SECRET)}`;
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
      console.log('ÉCHEC');
      console.error(`  ${err.message}`);
      process.exit(1);
    }

    totals.received += result.received || 0;
    totals.updated += result.updated || 0;
    totals.notFound += result.notFound || 0;
    totals.failed += result.failed || 0;
    if (Array.isArray(result.notFoundEmails)) {
      totals.notFoundEmails.push(...result.notFoundEmails);
    }
    console.log(`updated=${result.updated} notFound=${result.notFound} failed=${result.failed}`);
  }

  console.log('');
  console.log('=== Résumé ===');
  console.log(`  Records envoyés: ${totals.received}`);
  console.log(`  Dates écrites:   ${totals.updated}`);
  console.log(`  Non trouvés:     ${totals.notFound}`);
  console.log(`  Échecs:          ${totals.failed}`);
  if (totals.notFoundEmails.length > 0) {
    console.log('');
    console.log('Emails du CSV introuvables dans Notion (à investiguer):');
    for (const e of totals.notFoundEmails.slice(0, 50)) console.log(`  - ${e}`);
    if (totals.notFoundEmails.length > 50) {
      console.log(`  ... (+${totals.notFoundEmails.length - 50} autres)`);
    }
  }
})();
