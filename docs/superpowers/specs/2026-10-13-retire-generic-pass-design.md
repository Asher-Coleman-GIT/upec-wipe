# Retire the generic pass (2026-10-13)

The generic pass (`generic-runner.js`, `--generic`, `generic.enabled`) was meant to cover the roughly 490 sites from The Markup, BADBOOL and the state registries that had no hand-mapped broker. The reviewed catalog (`data/catalog/`, 641 sites) now covers those lists, and the pass is off by default.

## Why

Measured on 2026-10-13 with the catalog dedupe that `lib/modes/run.js` applies, `--generic` would visit 23 sites:

- 11 broken registry rows, where a word sits in the URL field (`glba`, `state`, `income`, `passport`, `liens`, `non-profit`, `sagestream` and similar). They fail DNS.
- 10 sites whose broker is already handled, because the pass dedupes by the exact opt-out URL host while the catalog keys on the broker's own domain. Examples: `huntclub.com` (form host for `exploreatlas.io`), `privacychoice.com` (`semcasting.com`), `eab.app.box.com` (`eab.com`, which the catalog **excluded**), `www.lexisnexis.com` (LexisNexis in `brokers.js`), `optout.aboutads.info.` (a trailing dot hides `aboutads.info`). The pass therefore re-submits to brokers the catalog deliberately handles or excludes.
- California's DROP portal (`consumer.drop.privacy.ca.gov`), which is done by hand.
- One broker with no catalog record: PureCars (`purecars.com`, opt-out on a Google Form).

Retiring the pass loses no reviewed coverage and removes a path that undermines catalog exclusions.

Decisions taken with the member:
- A leftover `--generic` or `generic.enabled: true` **refuses and exits** (as `--pollute` does), rather than being ignored.
- The source data and `update-brokers` stay, as inputs to the catalog.
- PureCars is added as a catalog candidate and surveyed; its review is left for the member.

## In scope

### 1. Refusal

- `watcher.js`, next to the `--pollute` check and before any config load, browser or network: when `process.argv` includes `--generic`, print `The generic pass was retired: its sites are in the reviewed catalog (data/catalog/). Remove --generic.` to stderr and exit 1.
- `lib/modes/run.js`, right after the config is loaded and before the egress check or browser launch: when `config.generic && config.generic.enabled === true`, print `The generic pass was retired: remove the "generic" block from config.json. Its sites are in the reviewed catalog (data/catalog/).` and exit 1. `generic.enabled: false` or no `generic` block runs normally.
- `upec-wipe doctor` reports a `generic` block with `enabled: true` as a problem, with the same fix text.

### 2. Removed

- `generic-runner.js`.
- In `lib/modes/run.js`: the `runGenericBrokers` require, `GENERIC_ENABLED`, the per-person generic loop and `results.genericStats`. `lib/logger.js` stops printing the generic totals in the run summary (its `genericStats` handling and the matching cases in `test/logger.test.js` go).
- `isGenericEnabled` in `lib/submission-plan.js` and its export.
- The `generic` block in `config.example.json`.
- `generic-runner.js` from the tier-1 lists in `scripts/cross-model-gate.sh` and `scripts/cross-model-review.sh`.
- Tests that only cover the removed pass: `allowlist-generic-runner`, `feeds-generic-runner`, `generic-runner-bugs`, `generic-catalog-exclusion`, `generic-selectors` (and `.browser`), `generic-runner-false-success`, `generic-runner-egress`, `generic-runner-audit`, `generic-runner-leak`, `generic-runner-per-person`, `generic-runner-encryption`. `watcher-generic-hoist` goes too. Generic-only cases inside shared test files (`debug-output`, `domain`, `playwright-loader`, `submission-plan`, `umask-file-modes`, `watcher-egress-wiring`, `logger`) are removed; the rest of those files stays.

### 3. Kept and moved

- New `lib/dead-urls.js` holds `loadDeadSet`, `DEAD_URLS_PATH`, `classifyNavError` and `isDeadStatus`, moved unchanged. `scripts/catalog-candidates.js`, `scripts/prune-dead.js` and `test/dead-url.test.js` import from it.
- `data/markup-parsed.json`, `data/badbool-extra.json`, `data/feeds-brokers.json` and `data/dead-urls.json` stay as catalog-candidate sources.
- `upec-wipe update-brokers` stays. Its help text, the comments in `lib/modes/update-brokers.js` and `lib/feeds.js`, and the docs say it refreshes the catalog candidate sources. The https-only filter in `lib/feeds.js` stays: registry rows still decide which sites the survey visits.
- The dashboard keeps `generic` in `FILE_ONLY_KEYS` (harmless, and it stops the dashboard writing the block back). Its help text drops the word "generic".

### 4. PureCars

- Re-run `node scripts/catalog-candidates.js` (no network). The expected change is one new candidate, `purecars.com`. If the output changes anything else, stop and report it rather than commit it.
- With Mullvad on, survey only that site: `node scripts/catalog-survey.js --only purecars.com`. Read-only. The record is committed as surveyed and `unreviewed`.
- The member reviews it later with `docs/CATALOG-REVIEW.md`. A Google Form opt-out needs `formHosts: ["google.com"]`.

### 5. Docs and output

- Run banner: `N explicit brokers + M catalog sites | re-check window: D days`. The `Generic brokers: off` line goes.
- `bin/upec-wipe.js` help and `lib/cli-map.js`: no `--generic`.
- README: the coverage table loses the generic row; the options line loses `--generic`.
- `docs/REFERENCE.md`: "Generic pass" becomes a short "Retired: the generic pass" note (what it was, why it went, that `--generic` now refuses). The `update-brokers` text matches section 3.
- `docs/UPEC-MANUAL.md`: the options paragraph loses `--generic`.
- `docs/PRIVACY.md`, `docs/THREAT-MODEL.md`: the generic-pass rows and sentences say the pass was retired.
- `STATUS.md`: the "~490 brokers ... handled by the heuristic generic runner" text points at the catalog instead.
- Dated documents under `docs/superpowers/` and `docs/plans/` are not changed.

## Testing

Test first. New tests:

- `node watcher.js --generic` exits 1, prints the retired message, and launches no browser and opens no network connection.
- `generic.enabled: true` in the run mode exits 1 with the message before the egress check runs.
- `generic.enabled: false` and no `generic` block reach the egress check as before.
- `doctor` flags `generic.enabled: true`.
- `generic-runner.js` does not exist, and no file in `lib/`, `bin/`, `scripts/` or `watcher.js` requires it.
- README, REFERENCE, the manual and `--help` mention `--generic` only as retired.
- `lib/dead-urls.js` passes the existing dead-url tests.

Then `npm test`, `node --test dashboard/*.test.js`, and the personal-data check before any push.

## Out of scope

- Fixing the registry parser for word-only rows: the candidate builder already drops them, and nothing else navigates to registry URLs now.
- Reviewing PureCars.
- Deleting the Markup and BADBOOL data or `update-brokers`.
