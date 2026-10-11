'use strict';
/**
 * lib/dob.js
 *
 * Date of birth as the member typed it in setup ("1990-04-07"), split into
 * the parts broker forms ask for. Returns null for anything that is not a
 * real past date, so a typo never reaches a form.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function parseDob(input) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input == null ? '' : input).trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (date > new Date() || y < 1900) return null;
  return { year: String(y), month: mo, monthName: MONTHS[mo - 1], day: String(d) };
}

module.exports = { parseDob };
