'use strict';
/**
 * lib/preview.js
 *
 * The person a preview or dry run fills forms with (2026-10-15 review): the
 * forms are not submitted, but a broker page's scripts can read what is typed,
 * so a rehearsal types nothing about the member. Only the state and country
 * are kept, so the same brokers apply (California DROP, Utah-basis sites, US
 * only). `preview --email` still shows the member's real letters on screen.
 */
const { PREVIEW_ALIAS } = require('./relay');

const PREVIEW_PERSON_NOTE = '   Filling forms as a dummy person (Jane Doe, Exampleton); listing searches are skipped, so nothing about you is typed into broker pages. Your state and country pick the same brokers.';

function previewPerson(real) {
  const r = real || {};
  return {
    firstName: 'Jane',
    lastName: 'Doe',
    fullName: 'Jane Doe',
    city: 'Exampleton',
    state: r.state || 'TX',
    country: r.country || 'US',
    zip: '00000',
    email: PREVIEW_ALIAS,
    dob: '1980-01-01',
  };
}

module.exports = { previewPerson, PREVIEW_PERSON_NOTE };
