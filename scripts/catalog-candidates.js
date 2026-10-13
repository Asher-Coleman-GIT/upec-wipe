#!/usr/bin/env node
// scripts/catalog-candidates.js - build data/catalog/candidates.json
//
//   node scripts/catalog-candidates.js
//
// Reads data/markup-parsed.json, data/badbool-extra.json and (when
// `upec-wipe update-brokers` has written it) data/feeds-brokers.json. No network.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { markupRows, badboolRows, feedRows, buildCandidates } = require(path.join(ROOT, 'lib/catalog-sources'));
const { explicitHostsOf } = require(path.join(ROOT, 'lib/feeds'));
const { loadDeadSet, DEAD_URLS_PATH } = require(path.join(ROOT, 'lib/dead-urls'));
const brokers = require(path.join(ROOT, 'brokers')).forPerson({ firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', state: 'TX', city: 'Austin', zip: '73301', email: 'jane@example.com', country: 'US' });

const rows = [
  ...markupRows(path.join(ROOT, 'data/markup-parsed.json')),
  ...badboolRows(path.join(ROOT, 'data/badbool-extra.json')),
  ...feedRows(path.join(ROOT, 'data/feeds-brokers.json')),
];
const candidates = buildCandidates({ rows, explicitHosts: explicitHostsOf(brokers), deadHosts: loadDeadSet(DEAD_URLS_PATH) });
const out = path.join(ROOT, 'data/catalog/candidates.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(candidates, null, 1) + '\n');
const bySource = {};
for (const r of rows) bySource[r.source] = (bySource[r.source] || 0) + 1;
console.log(`Sources: ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`Candidates: ${candidates.length} unique sites written to data/catalog/candidates.json`);
