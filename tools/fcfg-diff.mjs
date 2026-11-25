#!/usr/bin/env node
// usage: node tools/fcfg-diff.mjs a.fcfg b.fcfg (also compares a FlashPrint re-export against ours)
import fs from 'node:fs';
import { parseFcfgBytes, compareProfiles } from '../src/index.mjs';
const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: fcfg-diff a.fcfg b.fcfg'); process.exit(2); }
const r = compareProfiles(parseFcfgBytes(fs.readFileSync(a)), parseFcfgBytes(fs.readFileSync(b)));
console.log(`printer differs: ${r.printerDiffers}  nozzle differs: ${r.nozzleDiffers}  material differs: ${r.materialDiffers}`);
for (const c of r.changed) console.log(`~ [${c.section}] ${c.key} (${c.category}): ${c.a} -> ${c.b}`);
for (const c of r.added) console.log(`+ [${c.section}] ${c.key}: ${c.value}`);
for (const c of r.removed) console.log(`- [${c.section}] ${c.key}: ${c.value}`);
console.log(`${r.unchangedCount} unchanged`);
process.exit(r.changed.length + r.added.length + r.removed.length ? 1 : 0);
