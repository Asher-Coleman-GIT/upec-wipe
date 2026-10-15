'use strict';
/**
 * test/imap.test.js
 *
 * lib/imap.js: the read-only IMAP client behind `upec-wipe read-email`. It can
 * only log in, EXAMINE (read-only open), SEARCH, FETCH with BODY.PEEK (never
 * sets \Seen) and log out. Anything that could change the mailbox is refused
 * before it is sent.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { openMailbox, createSession, quote, imapDate } = require('../lib/imap');

// A scripted server: each client command gets the reply the script returns.
function fakeServer(script) {
  const sock = new EventEmitter();
  sock.sent = [];
  sock.write = (data) => {
    const line = String(data).replace(/\r\n$/, '');
    sock.sent.push(line);
    const [tag, ...rest] = line.split(' ');
    const reply = script(rest.join(' '), tag);
    // Deliver in two chunks to exercise reassembly across reads.
    const buf = Buffer.from(reply, 'latin1');
    const cut = Math.floor(buf.length / 2);
    setImmediate(() => { sock.emit('data', buf.subarray(0, cut)); setImmediate(() => sock.emit('data', buf.subarray(cut))); });
    return true;
  };
  sock.end = () => {};
  sock.destroy = () => {};
  setImmediate(() => sock.emit('data', Buffer.from('* OK IMAP ready\r\n')));
  return sock;
}

const MESSAGE = 'From: Privacy <privacy@broker.example>\r\nSubject: Done\r\n\r\nYour request has been completed.\r\n';

function gmailLike(cmd, tag) {
  if (cmd.startsWith('LOGIN')) return `${tag} OK logged in\r\n`;
  if (cmd === 'EXAMINE "INBOX"') return `* 2 EXISTS\r\n${tag} OK [READ-ONLY] examined\r\n`;
  if (cmd === 'EXAMINE "[Gmail]/Spam"') return `${tag} NO no such folder\r\n`;
  if (cmd.startsWith('SEARCH SINCE')) return `* SEARCH 1 2\r\n${tag} OK done\r\n`;
  if (/^FETCH [12] \(BODY\.PEEK\[\]<0\.200000>\)$/.test(cmd)) return `* ${cmd.split(' ')[1]} FETCH (BODY[]<0> {${Buffer.byteLength(MESSAGE)}}\r\n${MESSAGE})\r\n${tag} OK fetched\r\n`;
  if (cmd === 'LOGOUT') return `* BYE\r\n${tag} OK bye\r\n`;
  return `${tag} BAD unexpected ${cmd}\r\n`;
}

test('reads messages with EXAMINE, SEARCH and FETCH BODY.PEEK only', async () => {
  let sock;
  const box = await openMailbox({ host: 'imap.example.com', user: 'me@example.com', pass: 'app pass', connect: async () => (sock = fakeServer(gmailLike)) });
  assert.equal(await box.examine('INBOX'), true);
  assert.deepEqual(await box.searchSince(new Date('2026-10-15T00:00:00Z')), [1, 2]);
  const raw = await box.fetchMessage(2);
  assert.equal(raw.toString('latin1'), MESSAGE);
  assert.equal(await box.examine('[Gmail]/Spam'), false, 'a missing folder is skipped, not fatal');
  await box.logout();
  const verbs = sock.sent.map(l => l.split(' ')[1]);
  assert.deepEqual([...new Set(verbs)], ['LOGIN', 'EXAMINE', 'SEARCH', 'FETCH', 'LOGOUT']);
  assert.ok(sock.sent.every(l => !/\b(SELECT|STORE|COPY|MOVE|EXPUNGE|APPEND|DELETE)\b/.test(l)));
});

test('commands that could change the mailbox are refused before sending', async () => {
  const sock = fakeServer(gmailLike);
  const s = createSession(sock);
  await s.greeting();
  for (const cmd of ['SELECT "INBOX"', 'STORE 1 +FLAGS (\\Seen)', 'COPY 1 Trash', 'MOVE 1 Trash', 'EXPUNGE', 'APPEND INBOX {3}', 'DELETE INBOX', 'FETCH 1 (BODY[])', 'FETCH 1 (RFC822)']) {
    await assert.rejects(s.command(cmd), /not allowed/, cmd);
  }
  assert.deepEqual(sock.sent, []);
});

test('a failed login is an error that never contains the password', async () => {
  const sock = fakeServer((cmd, tag) => `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
  await assert.rejects(
    openMailbox({ host: 'imap.example.com', user: 'me@example.com', pass: 'secret-app-pass', connect: async () => sock }),
    (err) => /Invalid credentials/.test(err.message) && !/secret-app-pass/.test(err.message));
});

test('quote escapes and refuses line breaks; imapDate is DD-Mon-YYYY', () => {
  assert.equal(quote('a "b" \\c'), '"a \\"b\\" \\\\c"');
  assert.throws(() => quote('x\r\nA2 DELETE INBOX'), /line break/);
  assert.equal(imapDate(new Date('2026-10-05T12:00:00Z')), '5-Oct-2026');
});
