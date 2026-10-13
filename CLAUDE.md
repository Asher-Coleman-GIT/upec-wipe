# UPEC-WIPE - instructions for AI agents

UPEC-WIPE (Web Identity Purge Engine) sends opt-out and deletion requests to data brokers through web forms and email. It is a fork of auto-identity-remove (Stephen Thorn, MIT) with a fail-closed privacy model. Read `docs/UPEC-MANUAL.md` for how a member uses it, `docs/THREAT-MODEL.md` for why the safeguards exist, and `docs/superpowers/specs/` for the designs.

Node.js (CommonJS), Playwright, `node:test`. Run `npm test` (about 80 s).

## Privacy rules (never relax these)

These look like friction. They are the product. An optimization that removes one is a regression.

- **No personal data in the repo.** Never put a real person's name, email, phone, address, ZIP or date of birth in any tracked file, test, fixture, commit message or PR text. Tests use the dummy person from `config.example.json` (Jane Doe, Austin TX). Credit in LICENSE/README is "the UPEC-WIPE contributors".
- **The member's real email is never sent anywhere.** Forms get the SimpleLogin relay alias; a missing alias blocks the person (fail closed), never a fallback to the real email.
- **Nothing leaves the machine off the VPN.** The browser and every Node-direct connection (SMTP, SimpleLogin, CapSolver, registries) pass the Mullvad egress gate (`lib/egress.js`). The email step re-checks it before every send and refuses `network.proxy`.
- **Email requests** (`lib/email-step.js`, `--email`): a plain run never sends email; `--email` needs an interactive terminal and the member typing `SEND`; one dedicated mailbox is both `smtp.user` and `smtp.from`; sends are paced (45 s) and capped (100 per run); each send is recorded before and after, and a broker is never emailed twice. A Utah-basis broker is emailed only for a Utah resident.
- **Catalog records** (`data/catalog/`) hold tokens like `{firstName}`, never values; `lib/catalog.js` validates them and `test/catalog-files.test.js` enforces it. An `email` record's address must come from `survey.contacts`.
- Never runs as root; there is no background scheduler.

## Things never to do

- Never run `setup.js` / `upec-wipe setup`: it overwrites the member's real `config.json`.
- Never read, print, copy or commit `config.json`, `config.json.enc`, `state.json`, `logs/` or `secrets/`.
- Never run `upec-wipe run` or `--email` (they submit real requests). `preview` types the member's real details into broker pages: to prove form selectors, dry-fill with the dummy person through `lib/forms.js` `fillForm` instead.
- Unknown flags to `scripts/catalog-survey.js` start a full survey of every site.
- Never force-push, rewrite published history, or push to `upec/hardening` directly: work on a branch and open a pull request.

## How to work here

- Test first: a failing test, then the fix, then `npm test` green. Every privacy rule above has tests; keep them.
- Before any push, scan the outgoing diff, the tree and the commit messages for real personal data.
- House style: plain hyphens only, no em or en dashes in any tracked file (`test/no-em-dashes.test.js`). No emoji in output.
- A new test that spawns `watcher.js` or `bin/upec-wipe.js` uses the config-free copy from `test/helpers/fixture-repo.js`: until the code under test works, the child can fall through to a real run with the member's config.
- Keep the attribution to auto-identity-remove (README, LICENSE). Environment variables are `UPEC_WIPE_*`; the command is `upec-wipe` (`bin/upec-wipe.js`).
- Dated documents under `docs/superpowers/` and `docs/plans/` are historical records: do not rewrite them.
