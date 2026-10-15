'use strict';
/**
 * lib/imap.js
 *
 * A minimal, read-only IMAP client for `upec-wipe read-email`, on Node's
 * built-in TLS (no new dependency). It can only LOGIN, EXAMINE a folder (the
 * read-only open), SEARCH, FETCH with BODY.PEEK (which never sets \Seen) and
 * LOGOUT. Any other command is refused before it is sent, so nothing in the
 * mailbox can be read-marked, moved, deleted or added.
 *
 * The caller passes the Mullvad gate (lib/egress.js) before openMailbox.
 */

const ALLOWED = new Set(['LOGIN', 'EXAMINE', 'SEARCH', 'FETCH', 'LOGOUT']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

class ImapError extends Error {
  constructor(message, { no = false } = {}) { super(message); this.name = 'ImapError'; this.no = no; }
}

function quote(s) {
  const v = String(s);
  if (/[\r\n]/.test(v)) throw new ImapError('IMAP string with a line break refused');
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function imapDate(d) {
  return `${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

function checkAllowed(line) {
  const verb = String(line).split(' ')[0].toUpperCase();
  if (!ALLOWED.has(verb)) throw new ImapError(`IMAP command ${verb} not allowed (read-only)`);
  if (verb === 'FETCH' && !/^FETCH \d+ \(BODY\.PEEK\[\]<0\.\d+>\)$/.test(line)) {
    throw new ImapError('IMAP FETCH not allowed without BODY.PEEK (read-only)');
  }
}

/** Line and literal reader over a socket's 'data' events. */
function createSession(socket) {
  let buf = Buffer.alloc(0);
  let waiter = null;
  let ended = false;
  let failure = null;
  let tagN = 0;
  const wake = () => { if (waiter) { const w = waiter; waiter = null; w(); } };
  socket.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]); wake(); });
  socket.on('end', () => { ended = true; wake(); });
  socket.on('close', () => { ended = true; wake(); });
  socket.on('error', (err) => { failure = err; wake(); });

  async function need(take) {
    for (;;) {
      const got = take();
      if (got !== undefined) return got;
      if (failure) throw new ImapError(`IMAP connection error: ${failure.message}`);
      if (ended) throw new ImapError('IMAP connection closed');
      await new Promise((resolve) => { waiter = resolve; });
    }
  }
  const line = () => need(() => {
    const i = buf.indexOf('\r\n');
    if (i < 0) return undefined;
    const l = buf.subarray(0, i).toString('latin1');
    buf = buf.subarray(i + 2);
    return l;
  });
  const bytes = (n) => need(() => {
    if (buf.length < n) return undefined;
    const b = Buffer.from(buf.subarray(0, n));
    buf = buf.subarray(n);
    return b;
  });

  // One response: a line, plus any {n} literals it announces.
  async function response() {
    let text = '';
    const literals = [];
    for (;;) {
      const l = await line();
      text += l;
      const m = /\{(\d+)\}$/.exec(l);
      if (!m) return { text, literals };
      literals.push(await bytes(Number(m[1])));
    }
  }

  return {
    async greeting() {
      const r = await response();
      if (!/^\* (OK|PREAUTH)\b/i.test(r.text)) throw new ImapError(`IMAP server did not greet: ${r.text.slice(0, 80)}`);
    },
    async command(cmd) {
      checkAllowed(cmd);
      const tag = `A${++tagN}`;
      socket.write(`${tag} ${cmd}\r\n`);
      const untagged = [];
      for (;;) {
        const r = await response();
        if (r.text.startsWith(`${tag} `)) {
          const rest = r.text.slice(tag.length + 1);
          if (/^OK\b/i.test(rest)) return untagged;
          throw new ImapError(`IMAP ${cmd.split(' ')[0]} failed: ${rest.slice(0, 120)}`, { no: /^NO\b/i.test(rest) });
        }
        untagged.push(r);
      }
    },
  };
}

function defaultConnect({ host, port, timeoutMs }) {
  const tls = require('tls');
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('timed out')));
    socket.once('secureConnect', () => resolve(socket));
    socket.once('error', reject);
  });
}

/**
 * Log in and return the read-only operations.
 * @returns {Promise<{ examine, searchSince, fetchMessage, logout }>}
 */
async function openMailbox({ host, port = 993, user, pass, connect = defaultConnect, timeoutMs = 30000 }) {
  const socket = await connect({ host, port, timeoutMs });
  const s = createSession(socket);
  try {
    await s.greeting();
    await s.command(`LOGIN ${quote(user)} ${quote(pass)}`);
  } catch (err) {
    try { socket.destroy(); } catch (_) { /* closing anyway */ }
    throw err;
  }
  return {
    /** Open a folder read-only. False when the server has no such folder. */
    async examine(box) {
      try {
        await s.command(`EXAMINE ${quote(box)}`);
        return true;
      } catch (err) {
        if (err.no) return false;
        throw err;
      }
    },
    async searchSince(date) {
      const out = await s.command(`SEARCH SINCE ${imapDate(date)}`);
      const ids = [];
      for (const r of out) {
        const m = /^\* SEARCH\b(.*)$/i.exec(r.text);
        if (m) ids.push(...m[1].trim().split(/\s+/).filter(Boolean).map(Number));
      }
      return ids.filter(Number.isInteger);
    },
    /** The first maxBytes of one message, read without marking it read. */
    async fetchMessage(id, maxBytes = 200000) {
      if (!Number.isInteger(id) || id < 1) throw new ImapError('bad message number');
      const out = await s.command(`FETCH ${id} (BODY.PEEK[]<0.${maxBytes}>)`);
      const withBody = out.find(r => r.literals.length);
      return withBody ? withBody.literals[0] : Buffer.alloc(0);
    },
    async logout() {
      try { await s.command('LOGOUT'); } catch (_) { /* closing anyway */ }
      try { socket.end(); } catch (_) { /* closing anyway */ }
    },
  };
}

module.exports = { openMailbox, createSession, quote, imapDate, ImapError };
