# Phase 2: privacy requests to data brokers by email

Date: 2026-10-11. Follows the site catalog (`2026-10-11-site-catalog-design.md`),
whose outline this replaces.

## Decisions

The member chose (2026-10-11):

- **Narrowed scope.** A business-group broker gets a request only when both hold:
  1. its privacy policy names Utah among the states whose residents have rights,
     or says it honors requests from all US residents (the quoted sentence and its
     URL are recorded as the basis);
  2. it holds consumer-level data (households, demographics, addresses), not only
     ad-tech identifiers or business contacts.
  Every other business broker is excluded: a request would hand it a name it may
  not have, for nothing in return.
- **Legal basis.** The Utah Consumer Privacy Act gives a right to opt out of sale
  and of targeted advertising for all personal data, and deletion of data the
  consumer provided. Requests ask for all three and cite the UCPA and any other
  applicable law.
- **Forms first.** A qualifying broker with a usable web form becomes an ordinary
  reviewed catalog form and runs under `--forms`. Email is for the rest.
- **Approach A: a dedicated mailbox sends directly.** The member creates a new
  Gmail account used only for this, with an app password, as both SMTP login and
  sender. Brokers see only that address. No SimpleLogin reverse alias, no new
  exception to the leak guard. The forms keep their SimpleLogin alias; the two
  identities are separate.
- **Separate flags.** `--forms` fills web forms; `--email` sends email requests.
  A plain run is `--forms`. Email never goes out without `--email`.
- **All at once.** The member approves the whole broker list once. One `--email`
  run sends every email unattended, paced, after a single `SEND` confirmation.
- **Replies are logged by hand** with `aidr reply`. No IMAP.

## Success

1. Each of the ~100 heuristic candidates (`Utah` or all-US sentence and a
   dominant consumer-data signal) is recorded as `email`, `reviewed`, `manual` or
   `excluded`; the remaining business sites are `excluded` with a one-line reason.
2. `aidr run --email --preview` prints every email exactly as it would go out and
   opens no SMTP connection.
3. `aidr run --email` sends each pending email once, paced, records each send as
   it happens, and never sends a broker a second email.
4. Brokers never see the real email, phone, ZIP, date of birth, street address or
   the forms alias.

## Catalog record: review state `email`

```json
"review": {
  "state": "email",
  "reviewedAt": "2026-10-12",
  "to": "privacy@example-broker.com",
  "basis": {
    "kind": "utah",
    "quote": "This section applies only to residents of Colorado, ... Utah, Virginia.",
    "url": "https://www.example-broker.com/privacy"
  },
  "note": "Consumer segmentation data; requests by email only."
}
```

Validation (`lib/catalog.js`, `validateRecord`):

- `email` joins `STATES`.
- `to` must be one of the record's `survey.contacts` (lowercased compare). No
  address can be typed into a record by hand.
- `basis.kind` is `utah` or `all-us`.
- `basis.quote` is a non-empty string of at most 400 characters with no email
  address in it.
- `basis.url` is https and on the record's domain or a listed `formHosts`.

The tracked-record test allows an email address in `review.to` only when it is
also in `survey.contacts`.

## Email text

A new template in `lib/email.js`, `_buildBodyUCPA(person, contact)`:

- Subject: `Privacy request: opt out of sale and targeted advertising, and delete`.
- Body: a request under the Utah Consumer Privacy Act and any other applicable
  privacy law to (1) stop selling or sharing the member's personal data, (2) stop
  processing it for targeted advertising, and (3) delete it; asks for a reply at
  the contact address.
- Identifies the member by full name, city and state only.
- Contact address: `email.smtp.from` (the dedicated mailbox).
- Never contains: the real email, phone, ZIP, date of birth, street address or
  the forms relay alias.

The two `method: 'email'` brokers in `brokers.js` use the same template in the
email step.

## Components

### `lib/email-step.js` (new)

- `buildEmailPlan({ catalog, brokers, person, state, maxPerRun })` returns
  `[{ key, name, to, basis, subject, body }]`: every catalog `email` record and
  every `brokers.js` email broker, minus those recorded as sent in
  `state.emailSent`, capped at `maxPerRun`. Entries with `status: 'unknown'` are
  returned separately so the member is asked about each before it is resent.
- `sendEmailPlan(plan, { transport, smtp, paceMs, sleep, recordSent, log })`
  sends one email at a time with `paceMs` between sends and calls `recordSent`
  after each success. Stops the run on an authentication or quota error; logs a
  per-broker error and continues otherwise.
- `checkEmailSetup({ config, person, isTTY })` returns `null` or the reason the
  step cannot run.

### `watcher.js`

- Flags `--forms` and `--email`. No flag means `--forms`. Both may be given.
- `--email` runs `checkEmailSetup`, prints the plan (broker, address, basis kind
  and quote, then the full text of the first email and the subject), asks the
  member to type `SEND`, then calls `sendEmailPlan`. Anything else aborts.
- `--email --preview` prints the plan and every email body; no SMTP.
- The existing in-run email path (`sendOptOutEmails`) runs only under `--email`.
- The scheduler keeps calling a plain run, so it never sends email.

### Setup check (`checkEmailSetup`)

Refuses, sending nothing, when:

- there is no `email.smtp` block;
- `smtpFromLeakReason` reports a leak (existing guard);
- `smtp.user` and `smtp.from` differ (new: Gmail rewrites the sender to the
  login, so the two must be the one dedicated address);
- stdin is not a TTY (no `SEND` confirmation possible).

The existing egress gate covers SMTP (node-direct calls go out via Mullvad).

### Pacing and cap

- `email.paceSeconds`, default 45.
- `email.maxPerRun`, default 100 (Gmail allows 500 a day).

### State

- `state.emailSent[key] = { to, at, messageId }`, written atomically after each
  successful send. Never expires.
- `state.emailSent[key] = { to, at, status: 'unknown' }` is written before a send
  and replaced after it, so an interrupted send is known. A rerun asks before
  resending an `unknown` entry.
- `state.emailFailures[key]` counts per-broker send errors. After two, the broker
  is listed as manual with a note to check the address.
- `state.emailReplies[key] = { outcome, at }`.

### `aidr reply <broker> <outcome>`

Outcomes: `honored`, `refused`, `verify`, `none`, `bounced`. Matches the broker
by name like `--only`. `bounced` lists the broker as manual afterwards.
`aidr list` and the dashboard show, for each email broker: not sent, sent (date),
or the logged reply.

## Error handling

| Case | Behaviour |
|---|---|
| Setup check fails | Print the reason; send nothing. |
| SMTP authentication error | Stop at the first email; nothing recorded; name the setting to fix. |
| Per-broker rejection (bad address, refused) | Log `error` with the SMTP code; continue; not recorded as sent. Two failures move it to manual. |
| Quota or rate-limit reply | Stop; keep what was sent; tell the member to rerun tomorrow. |
| Interruption | Sent entries are already recorded; the in-flight one is `unknown`; a rerun skips the sent and asks about the unknown. |

## Testing

All test-first and offline (stub transport, fake sleep):

- validator: `email` accepted; rejects `to` outside `survey.contacts`, a quote with
  an address, an off-domain basis URL, an unknown `basis.kind`;
- template: name, city, state and the dedicated contact present; none of the
  `config.example.json` email, phone, ZIP or date of birth, nor a relay alias;
- plan: only `email` records and email brokers; skips `emailSent`; applies the cap;
- sender: paced, records per send, stops on auth and quota errors, continues on a
  per-broker error, resumes after interruption without duplicates, `unknown` handling;
- flags: a plain run never calls the email step; `--forms` alone sends no email;
  `--email` without a TTY refuses; anything but `SEND` aborts;
- `aidr reply`: validates the outcome, matches by name, writes `emailReplies`;
- the existing suite, including the relay leak tests, stays green.

## Review of the candidates

After the code lands, Claude reads each of the ~100 candidates' privacy pages
(scan results in the session scratchpad, not tracked) and records each as
`email`, `reviewed` (web form, proved by a dry fill with the dummy person),
`manual` or `excluded`. The member approves the full list once before any send.

## Out of scope

- SimpleLogin reverse aliases and per-broker aliases.
- Reading replies automatically (IMAP).
- Resending or follow-up emails.
- Requests to the ~420 excluded business brokers.
