#!/usr/bin/env node
// scripts/catalog-batch.js - print the next people-search records to review.
//
//   node scripts/catalog-batch.js [--size 20]
'use strict';
const path = require('path');
const { loadCatalog } = require(path.join(__dirname, '..', 'lib/catalog'));
const i = process.argv.indexOf('--size');
const size = i >= 0 ? Number(process.argv[i + 1]) : 20;
const batch = loadCatalog().filter(r => r.group === 'people-search' && (r.review || {}).state === 'unreviewed').slice(0, size);
for (const r of batch) {
  const s = r.survey || {};
  console.log(`\n${r.domain}  (${r.name})  ${s.optOutUrl || ''}  captcha=${!!s.captcha}${s.block ? ' block=' + s.block : ''}`);
  for (const c of s.controls || []) console.log(`  f${c.form} ${c.tag}/${c.type} id=${c.id} name=${c.name} ph="${c.placeholder}" label="${String(c.label || '').slice(0, 40)}" ${c.heading ? '[' + c.heading + ']' : ''}${c.options ? ' options=' + c.options.slice(0, 4).join('|') : ''}`);
  for (const b of s.buttons || []) if (b.inForm) console.log(`  button "${b.text}"`);
}
console.log(`\n${batch.length} record(s) in this batch.`);
