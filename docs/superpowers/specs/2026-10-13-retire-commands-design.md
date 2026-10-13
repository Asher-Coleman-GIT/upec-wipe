# Retire the side commands and the dashboard (2026-10-13)

Follows `2026-10-13-retire-generic-pass-design.md`. UPEC-WIPE's job is the monthly opt-out: web forms, email requests, replies, verification. Several commands grew around that job from upstream. Some cite the wrong law for the members (Utah residents), some send more about the member than the core flow does, and the dashboard can no longer run the core flow. This retires them.

Decisions taken with the member:
- Remove `know`, `know-status`, `complaints`, `breach`, `score`, `report`, `freeze`, `snapshot`, `confirm-emails`, `serp` and `dashboard`, and `reply --right-to-know`.
- Move `update-brokers` to a maintainer script.
- Keep `serp-watch`.
- Removed flags refuse loudly, as `--generic` does.
- A `clear` / `clear-all` command is a separate design, not part of this spec.

## Why each goes

| Command | Reason |
| --- | --- |
| `know`, `know-status` | `pickRegime` (`lib/right-to-know.js`) returns CCPA for every non-EU member, so a Utah resident's request cites a California law that does not apply. It also sends the phone number, which the email step deliberately does not. |
| `complaints` | Same CCPA/GDPR-only logic: for a Utah member it drafts complaints to the wrong regulator. |
| `breach` | The only command that sends the member's real email to a third party (Have I Been Pwned), and it needs a paid API key. |
| `score`, `report` | Built from breach, search-engine and verify data; without `breach` the score measures little, and `report` is a PDF of that score. |
| `freeze` | A checklist that sends nothing. It reads better as a manual section. |
| `snapshot` | Saves a screenshot of every filled form, with the member's details, to `logs/snapshots/`. Undocumented. |
| `confirm-emails` | Reads exported `.eml` files and clicks their links unattended: one forged "confirm" email becomes a tracking or phishing click. The manual already tells members to click by hand. Undocumented. |
| `serp` | `serp-watch` does the same search and also lists what is new. |
| `dashboard` | Cannot run the email step (it needs a terminal and `SEND` by design), log replies or run `catalog-check`; duplicates the CLI elsewhere; and is the largest attack surface (a local web server with a login), about 1,900 lines. |
| `update-brokers` (moved) | Since the generic pass was retired it only refreshes catalog candidate sources: maintainer work. |

## In scope

### 1. Refusal

- `watcher.js` replaces the separate `--generic` check with one table, `REMOVED`, checked right after the `--pollute` check and before flags are parsed, config is read or any browser module loads. An argument matches an entry when it equals the flag or starts with `<flag>=`. A match prints `<flag> was removed: <reason>. See docs/REFERENCE.md.` (or the entry's own message) to stderr and exits 1.
- Entries and messages:

| Flag | Message |
| --- | --- |
| `--generic` | the existing text, unchanged: `The generic pass was retired: its sites are in the reviewed catalog (data/catalog/). Remove --generic.` |
| `--know`, `--know-status` | `--know was removed: it cited California law (CCPA) for every non-EU member. See docs/REFERENCE.md.` (with the flag's own name) |
| `--complaints` | `--complaints was removed: it cited California law (CCPA) for every non-EU member. See docs/REFERENCE.md.` |
| `--breach-check` | `--breach-check was removed: it sent your real email to Have I Been Pwned. See docs/REFERENCE.md.` |
| `--score`, `--report` | `<flag> was removed: the exposure score depended on the breach check. See docs/REFERENCE.md.` |
| `--freeze`, `--freeze-done`, `--freeze-clear` | `<flag> was removed: the freeze checklist is in docs/UPEC-MANUAL.md.` |
| `--snapshot` | `--snapshot was removed: it saved screenshots of forms with your details. See docs/REFERENCE.md.` |
| `--confirm-emails` | `--confirm-emails was removed: click confirmation links yourself. See docs/REFERENCE.md.` |
| `--serp-scan` | `--serp-scan was removed: use upec-wipe serp-watch.` |
| `--update-brokers` | `--update-brokers moved: run node scripts/update-catalog-sources.js.` |
| `--right-to-know` | `--right-to-know was removed with the know command. See docs/REFERENCE.md.` |

- `bin/upec-wipe.js`: the removed subcommands (`know`, `know-status`, `complaints`, `breach`, `score`, `report`, `freeze`, `serp`, `dashboard`, `update-brokers`) leave `lib/cli-map.js` and are listed in a `REMOVED_COMMANDS` map that prints the matching message (for `dashboard`: `dashboard was removed: use the CLI; see docs/REFERENCE.md.`) and exits 1, instead of "unknown command".
- `--dry-run` stays as an undocumented alias of `--preview`.

### 2. Removed code

- `lib/modes/`: `know.js`, `know-status.js`, `complaints.js`, `breach.js`, `score.js`, `report.js`, `freeze.js`, `confirm-emails.js`, and their entries in `lib/mode-dispatch.js` and `lib/cli-flags.js`.
- `lib/`: `exposure.js`, `complaint.js`, `right-to-know.js`, `right-to-know-runner.js`, `hibp.js`, `freeze.js`, `report.js`, `snapshot.js`, `imap-confirm.js`, `dashboard-creds.js`. Before deleting, confirm with grep that nothing outside the removed set requires each one; a module with another user stays and is reported.
- `lib/broker-runner.js`: the snapshot wiring.
- `lib/modes/reply.js`: `--right-to-know` and the `KNOW_PREFIX` require. `reply` keeps every outcome for email requests.
- `dashboard/` (the whole folder), its entries in `package.json` (`files`, the `test` script), the dashboard step and closing hint in `install.sh`, and anything in `docker-compose.yml` or the `Dockerfile` that only serves the dashboard.
- `config.example.json`: the `hibp` block.
- Tests that only cover removed code. Shared test files lose only their removed cases.

### 3. Moved

- `scripts/update-catalog-sources.js` runs what `lib/modes/update-brokers.js` ran (same `lib/feeds.js` call, same output file `data/feeds-brokers.json`, same egress check). `lib/modes/update-brokers.js` goes.
- The freeze checklist becomes a "Credit and identity freezes" section in `docs/UPEC-MANUAL.md`, built from the destinations in `lib/freeze.js` (name, URL, what it does) before that file is deleted.

### 4. Leftover member data

- `state.json` may hold `know:` entries, `freezes`, or breach history. Left alone: nothing reads them, and rewriting the member's state is not worth the risk.
- `doctor`'s `retired` check also reports, each as a problem with its fix text:
  - a `hibp` block in the config: `remove the "hibp" block from config.json (the breach check was removed)`;
  - `logs/snapshots/`, `logs/reports/` or `data/exposure-history.json` present: `<path> holds your details from a removed command; delete it when you no longer need it`.
  Doctor never deletes anything itself.

### 5. Docs and output

- README: the command table and the options line lose the removed commands; the layout map loses `dashboard/`.
- `docs/REFERENCE.md`: a "Retired commands" table (command, why, what to use instead), replacing the per-command text; the environment-variable table loses the dashboard rows; `update-brokers` text points at the new script.
- `docs/UPEC-MANUAL.md`: the command reference, the "Dashboard (optional)" section and the `breach`/`serp` sentences change; the new freeze section is added; Docker commands say `preview`.
- `docs/PRIVACY.md`, `docs/THREAT-MODEL.md`: the HIBP, dashboard, `serp` and right-to-know rows and sentences go or say retired; "Who learns what" loses HIBP.
- `CLAUDE.md`: the privacy-rules line about the dashboard ("the dashboard listens on loopback only") and any mention of `know` change to match.
- `SECURITY.md`, `docs/SYNOLOGY.md`, `FORK.md`: any dashboard or removed-command mention.
- `--help` lists only the kept commands.
- Dated documents under `docs/superpowers/` and `docs/plans/` are not changed.

## Testing

Test first. Every test that spawns `watcher.js` or `bin/upec-wipe.js` has its failing run in a config-free scratch copy of the repo, never the real tree: before a refusal exists, the child falls through to a real run.

- Each `REMOVED` flag, alone and as `<flag>=x`, exits 1 with its message and loads no browser module.
- Each removed subcommand in `bin/upec-wipe.js` exits 1 with its message.
- A source-order test: the `REMOVED` check in `watcher.js` comes before `parseWatcherFlags` and any `require` of config or the browser.
- No file in `lib/`, `bin/`, `scripts/` or `watcher.js` requires a removed module; `dashboard/` does not exist.
- `--help` does not list a removed command.
- `reply <broker> honored` still logs; `reply ... --right-to-know` is refused.
- `scripts/update-catalog-sources.js` calls the same feeds refresh (tested with an injected fetch, as `test/feeds-https-cap.test.js` does).
- `doctor` reports a `hibp` block and each leftover path; it passes without them.
- Docs: no kept doc lists a removed command except in the "Retired commands" table or with "removed"/"retired" on the same line.

Then `npm test`, the count-only personal-data check, and a final review.

## Out of scope

- `clear` / `clear-all` (separate design).
- Rewriting `state.json` to drop old keys.
- The README `--email` coverage section and the CLI banner (separate, after this lands).
