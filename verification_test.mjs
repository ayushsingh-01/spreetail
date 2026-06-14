import fs from 'fs';
import path from 'path';

// Mock next/server and other modules if needed, but since we are using require,
// let's write a self-contained parser verification that requires lib/parser.js.
// Wait! lib/parser.js uses ES modules (import/export). To run it in standard node,
// we can either use dynamic import() or run a quick test that parses the csv text.
// Let's write a simple script that dynamically imports our parser or replicates the exact logic to output the anomalies!
// Actually, since Node supports ES modules dynamically, we can use dynamic import, or we can write a script that does the check.
// Let's write it in ES module format (e.g. rename it to verification_test.mjs) or just run it via dynamic import.
// Let's write verification_test.mjs to use ESM!

import { parseCSVData, detectDuplicates } from './src/lib/parser.js';

const csvPath = path.resolve(process.cwd(), 'Expenses Export.csv');
const csvText = fs.readFileSync(csvPath, 'utf8');

console.log('--------------------------------------------------');
console.log('RUNNING PARSER VERIFICATION ON Expenses Export.csv');
console.log('--------------------------------------------------');

try {
  const records = parseCSVData(csvText);
  const duplicates = detectDuplicates(records);

  console.log(`Successfully parsed ${records.length} records.`);
  console.log(`Found ${duplicates.length} duplicate/conflict pairs.\n`);

  console.log('--- ALL DETECTED ANOMALIES BY ROW ---');
  let anomalyCount = 0;
  records.forEach(row => {
    if (row.anomalies.length > 0) {
      console.log(`\nRow ${row.rowNum}: "${row.description}" | Date: ${row.dateRaw} | Payer: ${row.paidByRaw} | Amount: ${row.amountRaw} ${row.currencyRaw}`);
      row.anomalies.forEach(anom => {
        anomalyCount++;
        console.log(`  [${anom.severity}] - ${anom.type}: ${anom.message}`);
      });
    }
  });

  console.log('\n--- DETECTED DUPLICATES/CONFLICTS ---');
  duplicates.forEach((dup, idx) => {
    console.log(`\nConflict ${idx + 1}: ${dup.type}`);
    console.log(`  Row A (${dup.rowA.rowNum}): "${dup.rowA.description}" | Paid: ${dup.rowA.amount} | Payer: ${dup.rowA.paidByNormalized}`);
    console.log(`  Row B (${dup.rowB.rowNum}): "${dup.rowB.description}" | Paid: ${dup.rowB.amount} | Payer: ${dup.rowB.paidByNormalized}`);
    console.log(`  Detail: ${dup.description}`);
  });

  console.log('\n--------------------------------------------------');
  console.log(`Summary: ${anomalyCount} row anomalies, ${duplicates.length} duplicate conflicts.`);
  console.log('--------------------------------------------------');
} catch (e) {
  console.error('Error running parser test:', e);
}
