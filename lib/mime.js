'use strict';
/**
 * lib/mime.js
 *
 * Decodes one email (RFC 5322 / MIME) into what `upec-wipe read-email`
 * shows: sender, subject, date, plain text, html and links. Handles folded
 * headers, encoded-word headers, nested multiparts, base64, quoted-printable
 * and charsets (via TextDecoder). Attachments are skipped. No dependency.
 */

function decodeCharset(bytes, charset) {
  try {
    return new TextDecoder((charset || 'utf-8').toLowerCase(), { fatal: false }).decode(bytes);
  } catch (_) {
    return Buffer.from(bytes).toString('latin1');
  }
}

function qpBytes(s) {
  const flat = s.replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(flat.slice(i + 1, i + 3))) {
      out.push(parseInt(flat.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(flat.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(out);
}

// =?charset?B|Q?text?= (RFC 2047); whitespace between two encoded words goes.
function decodeWords(v) {
  return String(v || '')
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, text) => {
      const bytes = enc.toUpperCase() === 'B' ? Buffer.from(text, 'base64') : qpBytes(text.replace(/_/g, ' '));
      return decodeCharset(bytes, cs);
    });
}

function parseHeaders(block) {
  const headers = {};
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if (!(name in headers)) headers[name] = line.slice(i + 1).trim();
  }
  return headers;
}

// "text/plain; charset=utf-8; boundary="x"" -> { type, params }
function parseContentType(v) {
  const [type, ...rest] = String(v || 'text/plain').split(';');
  const params = {};
  for (const p of rest) {
    const m = /^\s*([\w-]+)\s*=\s*"?([^";]*)"?/.exec(p);
    if (m) params[m[1].toLowerCase()] = m[2];
  }
  return { type: type.trim().toLowerCase(), params };
}

function splitHeadBody(s) {
  const m = /\r?\n\r?\n/.exec(s);
  return m ? [s.slice(0, m.index), s.slice(m.index + m[0].length)] : [s, ''];
}

function decodeBody(body, headers) {
  const cte = String(headers['content-transfer-encoding'] || '').toLowerCase();
  if (cte === 'base64') return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (cte === 'quoted-printable') return qpBytes(body);
  return Buffer.from(body, 'latin1');
}

// Walk the MIME tree (body kept as a latin1 string, so bytes are preserved).
function walk(s, out, depth = 0) {
  const [head, body] = splitHeadBody(s);
  const headers = parseHeaders(head);
  const { type, params } = parseContentType(headers['content-type']);
  if (type.startsWith('multipart/') && params.boundary && depth < 10) {
    const parts = body.split(`--${params.boundary}`);
    for (const part of parts.slice(1)) {
      if (part.startsWith('--')) break;
      walk(part.replace(/^\r?\n/, ''), out, depth + 1);
    }
    return headers;
  }
  if (/attachment/i.test(headers['content-disposition'] || '')) return headers;
  if (type === 'text/plain' || type === 'text/html') {
    const text = decodeCharset(decodeBody(body, headers), params.charset);
    if (type === 'text/plain') out.text += text;
    else out.html += text;
  }
  return headers;
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
function decodeEntities(s) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m;
  });
}

function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<\/?(a|b|i|u|em|strong|span|font|small)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim();
}

function linksOf(text, html) {
  const urls = [
    ...[...String(html).matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map(m => decodeEntities(m[1])),
    ...[...String(text).matchAll(/https?:\/\/[^\s<>"')\]]+/g)].map(m => m[0].replace(/[.,;:]+$/, '')),
  ];
  return [...new Set(urls)];
}

/**
 * @param {Buffer} raw  the message (possibly truncated)
 * @returns {{ from, fromAddress, subject, date, text, html, links }}
 */
function parseMessage(raw) {
  const s = Buffer.isBuffer(raw) ? raw.toString('latin1') : String(raw);
  const out = { text: '', html: '' };
  const headers = walk(s, out);
  const from = decodeWords(headers.from || '');
  const addr = /<([^>]+)>/.exec(from);
  const date = headers.date ? new Date(headers.date) : null;
  return {
    from,
    fromAddress: (addr ? addr[1] : from).trim().toLowerCase(),
    subject: decodeWords(headers.subject || '').replace(/\s+/g, ' ').trim(),
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    // Html-only mail (several broker replies) still needs readable text.
    text: (out.text.trim() ? out.text : htmlToText(out.html)).replace(/\r\n/g, '\n').trim(),
    html: out.html,
    links: linksOf(out.text, out.html),
  };
}

module.exports = { parseMessage, htmlToText, decodeWords };
