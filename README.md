# UPEC-WIPE

**Web Identity Purge Engine** - a privacy-first tool that asks data brokers and people-search sites to stop selling your personal information and delete it.

![CI](https://github.com/Asher-Coleman-GIT/auto-identity-remover-upec/actions/workflows/test.yml/badge.svg)

UPEC-WIPE sends requests; it cannot erase anything itself. Each broker decides how fully it complies, and some will refuse, especially where your state's law gives you few rights. What the tool does is make every request you are entitled to send, with as little extra exposure as possible.

> **Fork of [auto-identity-remove](https://github.com/stephenlthorn/auto-identity-remove)** by Stephen Thorn (MIT). UPEC-WIPE keeps its form-filling engine and adds a fail-closed privacy model and new subsystems; see [What changed from auto-identity-remove](#what-changed-from-auto-identity-remove). Start with [docs/UPEC-MANUAL.md](docs/UPEC-MANUAL.md). [**Privacy & data flow ->**](docs/PRIVACY.md)

## What changed from auto-identity-remove

- **Fail closed on privacy.** A SimpleLogin alias is required for every form; your real email is never sent. Nothing leaves your computer unless Mullvad is connected. It never runs as root, the dashboard listens on this computer only, and there is no background scheduler: it runs only when you start it.
- **A reviewed site catalog** (`data/catalog/`): every site from the public broker lists was surveyed; people-search sites are reviewed by hand into automatic forms, manual links or exclusions, and re-checked for changes (`upec-wipe catalog-check`).
- **Email requests** (`upec-wipe run --email`): brokers that take requests only by email get a privacy request (opt out of sale and targeted advertising, and delete) from a dedicated mailbox, with the policy sentence that gives the right recorded for each one. Forms and email are separate steps (`--forms`, `--email`).

## What it does

Each time you run it, the tool:

1. **Searches** each data broker site for your name + state
2. **Finds your specific listing** (for sites that need a profile URL)
3. **Fills and submits** the opt-out form automatically
4. **Solves CAPTCHAs** via [CapSolver](https://capsolver.com) (optional, ~$0.001/solve)
5. **Skips** brokers you were already removed from recently (90-day re-check window)
6. **Opens** any sites that require manual action in your browser

Beyond the opt-out run, it can also:

- **Score your exposure** - a single 0-100 number with a month-over-month trend (`upec-wipe score`), built from verified removals, search-engine visibility, and breach data
- **Close the loop** - re-verify removals (`upec-wipe verify`), watch search engines for new listings (`upec-wipe serp-watch`), and generate a monthly PDF report (`upec-wipe report`)
- **Add teeth** - send CCPA/GDPR right-to-know requests (`upec-wipe know`) and auto-generate regulator complaints when a broker blows the legal deadline (`upec-wipe complaints`)
- **Protect proactively** - check Have I Been Pwned (`upec-wipe breach`) and walk a credit/identity-freeze checklist (`upec-wipe freeze`)
- **Stay private** - submit from a masked relay email (SimpleLogin), encrypt `config.json` at rest (AES-256-GCM, opt-in via `UPEC_WIPE_PASSPHRASE`), and detect success/confirmation text in 6 languages
- **Run from a browser** - an optional local web dashboard with a first-run config wizard, live run console, and status board (`upec-wipe dashboard`)
- **Keep coverage fresh** - pull the broker list from the official California (SB 362) and Vermont registries (`upec-wipe update-brokers`), and keep brokers you *want* to stay listed on via an allowlist

---

## Requirements

- Node.js 20+
- macOS, Linux, or Windows
- [Playwright](https://playwright.dev) browsers installed

```bash
npx playwright install chromium
```

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/Asher-Coleman-GIT/auto-identity-remover-upec.git upec-wipe
cd upec-wipe

# 2. One-command install (checks Node, installs deps + the Chromium browser)
bash install.sh

# 3. Run interactive setup (creates config.json)
node bin/upec-wipe.js setup

# 4. Preview what it will do - submits nothing
node bin/upec-wipe.js preview

# 5. Run for real anytime
node bin/upec-wipe.js run
```

> Tip: run `npm link` (or `npm i -g .`) so you can type `upec-wipe` directly instead
> of `node bin/upec-wipe.js`. There is no `./node_modules/.bin/upec-wipe` - npm only
> creates `.bin` shims for *dependencies*, never for the package's own `bin`.

### The `upec-wipe` command

`upec-wipe` is a friendly wrapper around the underlying scripts. Every subcommand
maps to an existing entrypoint:

| Command | What it does |
|---------|--------------|
| `upec-wipe setup` | Interactive first-run setup (creates `config.json`) |
| `upec-wipe preview` | Dry-run: fills forms but submits nothing |
| `upec-wipe run` | Runs the opt-out pass for real |
| `upec-wipe verify` | Re-searches brokers and reports whether you still appear |
| `upec-wipe score` | Prints your 0-100 exposure score and its month-over-month trend |
| `upec-wipe report` | Generates the monthly PDF report (saved locally) |
| `upec-wipe pending` | Lists brokers awaiting an email-confirmation click |
| `upec-wipe serp` | Scans search engines for where your name still ranks |
| `upec-wipe serp-watch` | Scans and lists domains where your name newly appears |
| `upec-wipe breach` | Checks Have I Been Pwned and recommends a credit freeze on high-severity breaches |
| `upec-wipe freeze` | Shows the credit/identity-freeze checklist and its status |
| `upec-wipe complaints` | Generates regulator complaints for brokers past the CCPA/GDPR deadline |
| `upec-wipe know` | Sends CCPA/GDPR right-to-know requests |
| `upec-wipe update-brokers` | Refreshes the broker list from the CA + Vermont registries |
| `upec-wipe list` | Lists configured brokers and their last-known status |
| `upec-wipe doctor` | Self-diagnoses your environment and configuration |
| `upec-wipe dashboard` | Starts the local web dashboard and prints its URL + a one-time login |

Pass extra flags straight through, e.g. `upec-wipe run --only Spokeo` or
`upec-wipe preview --skip BeenVerified`. Run `upec-wipe --help` for the full list.
Every subcommand maps to the equivalent `node watcher.js --<flag>` invocation.

> A native desktop wrapper (Electron/Tauri) is a planned follow-up and is **not**
> included here - this release is clean CLI packaging only.

---

## Setup walkthrough

`node setup.js` guides you through:

| Step | What it does |
|------|-------------|
| **Personal info** | Name, city, state, ZIP, email, phone |
| **Aliases** | Past names or variations (e.g. "Steve Doe") |
| **CapSolver key** | For CAPTCHA-protected opt-out forms |
| **SimpleLogin key** | Brokers get an alias instead of your real email; nothing is submitted until it is set |

**Your personal info never leaves your machine.** `config.json` and `state.json` are both gitignored.

This fork runs only when you start it. Setup installs no scheduled job; run it yourself (about once a month is plenty).

---

## CapSolver (optional but recommended)

Some opt-out forms have reCAPTCHA. Without CapSolver, those sites go to your manual list instead of being handled automatically.

1. Sign up at [capsolver.com](https://capsolver.com) - free, pay-as-you-go
2. Add $1-2 of credits (enough for months of use at ~$0.001/solve)
3. Paste your API key when `setup.js` asks, or add it to `config.json`:

```json
"capsolver": {
  "apiKey": "CAP-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

> **CapSolver is optional.** Without it, CAPTCHA-protected sites are flagged as
> manual and opened in your browser for completion. Pass `--no-capsolver` to skip
> them entirely rather than opening the browser.

---

## Running with Docker

The `Dockerfile` uses the official Playwright image, so Chromium and all system
dependencies are pre-installed. No Mac required. Builds for `linux/amd64` and
`linux/arm64`; the amd64 image is about 940 MB.

```bash
# Build the image (once)
docker build -t upec-wipe .

# Dry-run - navigates and checks reachability, submits nothing
docker run --rm --init \
  -v "$(pwd)/config.json:/app/config.json" \
  -v "$(pwd)/state.json:/app/state.json" \
  -v "$(pwd)/logs:/app/logs" \
  -e TZ="$(date +%Z)" \
  upec-wipe node watcher.js --dry-run

# Full run
docker run --rm --init \
  -v "$(pwd)/config.json:/app/config.json" \
  -v "$(pwd)/state.json:/app/state.json" \
  -v "$(pwd)/logs:/app/logs" \
  -e TZ="$(date +%Z)" \
  upec-wipe
```

Or with compose: `docker compose run --rm watcher node watcher.js --dry-run`.

**Create `state.json` before the first run** - `touch state.json` is enough. If
the path does not exist, Docker creates a *directory* there and the run fails on
a confusing `EISDIR`.

**`--init` matters.** Without it node is PID 1, `docker stop` cannot reap the
Chromium children, and the state lock is left behind, wedging the next run.

**`TZ` matters.** Containers are UTC. Without it every report timestamp lands
in the wrong hour.

**Prefer mounting a directory over individual files.** `rename()` onto a Docker
single-file bind mount fails with `EBUSY`, which is how every state write in
Docker used to be silently discarded. There is now a fallback that keeps state
working with file mounts, but it gives up crash-atomicity. To keep the
guarantee, mount a directory and point `UPEC_WIPE_STATE_PATH` inside it:

```bash
docker run --rm --init \
  -v "$(pwd):/app/data" \
  -e UPEC_WIPE_STATE_PATH=/app/data/state.json \
  upec-wipe
```

**Low-RAM hosts** (NAS, Raspberry Pi, small VPS): add `-e UPEC_WIPE_LOW_MEMORY=1`. A
full 40-broker run peaks at about 250 MB either way; the flag trades some render
fidelity for less background work on slow cores.

> **Synology / NAS users:** see [docs/SYNOLOGY.md](docs/SYNOLOGY.md) for a full
> DSM Container Manager walkthrough, measured memory numbers,
> and the three defects that used to make the container unusable.

---

## Files

```
upec-wipe/
├── setup.js            ← Run once: interactive setup
├── watcher.js          ← Main runner
├── brokers.js          ← Broker list with opt-out strategies
├── run.sh              ← Manual trigger
├── config.example.json ← Template (copy → config.json)
├── package.json
├── .gitignore
│
├── config.json         ← YOUR personal info (gitignored, created by setup.js)
├── state.json          ← Opt-out history / skip logic (gitignored)
└── logs/               ← Per-run JSON logs (gitignored)
```

---

## State tracking

`state.json` tracks when each broker was last successfully opted out. The default re-check window is **90 days** - brokers typically re-add your data within that window, so the script re-submits when it's time.

```json
{
  "optOuts": {
    "Spokeo": {
      "lastSuccess": "2026-05-01T09:00:00.000Z",
      "totalRuns": 3,
      "detail": ""
    }
  }
}
```

On each run you'll see:
- `Submitted (form accepted)` - opt-out form was submitted this run
- `Awaiting email confirm` - broker replied "check your email to confirm"; click the link in your inbox. Auto-retried after 14 days if still pending.
- `Skipped` - not attempted this run: done recently (re-check not due), waiting on an email confirmation, on your allowlist, US-only for a non-US person, or a dry run
- `Previewed (not submitted)` - a preview filled the form but sent nothing (preview only)
- `Not listed` - your name wasn't found on that site
- `Manual needed` - opened in your browser for you to handle
- `Errors` - network/timeout issue, will retry next run
- `Dead (stale URL)` - broker URL is gone (DNS/404); not counted as an error

> **Submitted ≠ confirmed deleted.** Use `node watcher.js --verify` for spot-check verification. See [STATUS.md](STATUS.md) for a per-broker confidence table.

## How confident should I be?

This tool covers 500+ data brokers in two tiers:

| Tier | Count | Confidence |
|---|---|---|
| **Explicit brokers** ([STATUS.md](STATUS.md)) | 32 | Hand-mapped with specific selectors. **None are currently marked `verified`** - none has been tested end to end. A read-only survey on 2026-10-10 re-read the live forms (see STATUS.md); sites behind bot protection are listed for you to do by hand, and a form the tool cannot fill is never submitted. |
| **Generic runner** | ~490 | Best-effort heuristic - tries 4 strategies (Do Not Sell click, OneTrust/TrustArc, generic form, DSAR link). Many succeed; some fail silently. |

Be skeptical of the counts this tool prints. Broker sites change their DOM
constantly and a selector that no longer matches fails quietly. That is the
central limitation of the whole approach, not a bug that is about to be fixed.

The `Submitted` count means the form was accepted by the broker. It does **not** prove deletion. To check:

1. Run `node watcher.js --verify` - re-searches each broker where a successful opt-out was recorded and reports whether your name still appears.
2. Look at the `Awaiting email confirm` section after each run - these are half-done until you click the link.

If you want to know exactly which brokers are hand-verified vs heuristic, see [STATUS.md](STATUS.md).

---

## Brokers covered

### Auto-removed (30+)

| Site | Method |
|------|--------|
| Spokeo | Search → find listing → opt-out form |
| WhitePages | Search → find listing → suppression form |
| FastPeopleSearch | Search → opt-out form |
| TruePeopleSearch | Direct opt-out form |
| BeenVerified | Manual (pick your own record) |
| Radaris | Search → privacy form |
| Intelius | Direct opt-out form |
| PeopleFinders | Direct opt-out form |
| PeopleSmart | Direct opt-out form |
| MyLife | Search → opt-out |
| Nuwber | Search → removal form |
| FamilyTreeNow | Direct opt-out form |
| CheckPeople | Direct opt-out form |
| ThatsThem | Direct opt-out form |
| USPhonebook | Direct opt-out form |
| PublicDataUSA | Direct opt-out form |
| SmartBackgroundChecks | Direct opt-out form |
| SearchPeopleFree | Direct opt-out form |
| PeopleSearchNow | Direct opt-out form |
| InfoTracer | Direct opt-out form |
| SocialCatfish | Direct opt-out form |
| NationalPublicData | Manual (needs your profile link) |
| ClustrMaps | Direct opt-out form |
| PrivateRecords | Direct opt-out form |
| **Acxiom** | Direct form (feeds dozens of downstream brokers) |
| **LexisNexis** | Direct form (legal/financial data) |
| **ZoomInfo** | Direct form (B2B professional data) |
| **Clearbit** | Direct form (B2B enrichment data) |
| Pipl | Email opt-out via Mail.app |

### Generic - 500+ additional brokers (auto-detected)

`generic-runner.js` handles the remaining ~470 brokers from two public datasets:

| Dataset | Source | Count |
|---------|--------|-------|
| [The Markup's data broker list](https://themarkup.org/privacy/2023/01/26/which-data-brokers-offer-opt-outs) | Journalism research, 494 opt-out URLs | ~494 |
| [BADBOOL](https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List) | Community-maintained people-search list | ~27 extra |

For each site it tries four strategies in order:
1. Click a "Do Not Sell My Personal Information" button
2. Opt out via OneTrust / TrustArc / Osano privacy manager
3. Fill any generic opt-out form (email, name, state) and submit
4. Find and record a DSAR / data request link for manual follow-up

Sites requiring manual action are opened in your browser automatically.

### Reviewed site catalog

Sites from the generic lists that have been checked by hand live in `data/catalog/`, one file per site. Reviewed sites run after the main brokers, with the same checks and the same status words; sites that need you get a link under Action Required. The generic pass never visits a site the catalog knows. See `docs/CATALOG-REVIEW.md` for how sites are surveyed and reviewed.

### Manual (opened in browser for you)

| Site | Why manual |
|------|-----------|
| Google - Results About You | Requires Google account interaction |
| Google - Outdated Content | Case-by-case URL submission |

---

## Adding more brokers

Edit `brokers.js` and add an entry:

```js
{
  name: 'NewBrokerSite',
  method: 'direct-form',           // or 'search-form', 'email', 'manual'
  optOutUrl: 'https://example.com/opt-out',
  formFields: {
    'input[name*="first" i]': F,   // F, L, N, E, ST, Z are from config
    'input[name*="last"  i]': L,
    'input[type="email"]':    E,
  },
  submitSelector: 'button[type="submit"]',
  captchaLikely: false,
  priority: 2,
}
```

PRs welcome - especially for brokers with verified working selectors.

---

## Manual run

```bash
./run.sh
```

**Dry-run mode** - navigates to each site and fills forms but does NOT submit anything. Good for verifying what the script will do before your first real run:

```bash
node watcher.js --dry-run
```

Or to run in the background and log output:

```bash
./run.sh >> logs/manual-run.log 2>&1 &
```

### Verifying removals (`--verify`)

Run a read-only spot-check to see whether previous opt-outs are still in effect:

```bash
node watcher.js --verify
```

This opens a browser, searches each broker where you have a recorded successful opt-out, and reports what it finds. No forms are submitted, nothing is written to `state.json`.

Output is grouped into three sections:

| Section | Meaning |
|---------|---------|
| `VERIFIED CLEAR` | Your name was not found in the broker's search today |
| `STILL LISTED` | A listing was found - the opt-out may have failed, or your data was re-added |
| `UNVERIFIABLE` | The broker uses a direct-form, email, or manual method - no automated search signal exists to check |

A dated JSON report is saved to `logs/verify-YYYY-MM-DD.json`.

**Important caveats:**

- Only `search-form` brokers (those with a `searchUrl` and `listingPattern`) can be checked automatically. Direct-form and email opt-outs are always `unverifiable`.
- "Verified clear" means your name was not found in one search today. It is **not** a legal guarantee of deletion. Brokers routinely re-ingest data from upstream sources.
- "Still listed" can mean the opt-out failed **or** the broker re-added your data since the last successful opt-out was recorded. Either way, re-running `node watcher.js` will attempt removal again.
- If the broker's search page is down or slow, the result is classified as `unverifiable` (a timeout is not counted as "still listed").

### Continuous SERP monitoring (`--serp-watch`)

`node watcher.js --serp-watch` runs a search-engine scan, diffs the broker domains it finds against the previous `data/serp-history.json` snapshot, and prints new domains and records them in `data/serp-history.json` when your name appears on a NEW domain. Because the scan appends to that file, repeated runs diff against the prior run. Run it after each opt-out run to catch new exposures.

---

## Maintenance

### Refreshing the broker list (`--update-brokers`)

The bundled Markup dataset is from January 2023 and is increasingly stale. Refresh the broker coverage from the official, auto-updating state data-broker registries:

```bash
node watcher.js --update-brokers
```

This fetches the California (SB-362) and Vermont registries over HTTP (no browser is launched), normalizes each entry, dedups it by hostname against the explicit brokers in `brokers.js`, and writes `data/feeds-brokers.json`. The generic runner loads that file alongside the Markup dataset on the next run; the Markup data stays as the fallback, so a failed or skipped refresh never reduces coverage. Override the registry URLs with the `CA_REGISTRY_URL` / `VT_REGISTRY_URL` environment variables if the official endpoints move.

---

### Pruning stale / dead URLs

The Markup dataset is years old; many of the ~489 generic opt-out URLs now 404 or fail DNS lookup. These are classified as `Dead (stale URL)` in run output and do **not** count as errors.

After several runs have accumulated in `logs/`, trim permanently-dead hostnames from future runs so they are skipped without any network request:

```bash
node scripts/prune-dead.js
```

The script:
1. Reads every `logs/run-*.json` file
2. Finds hostnames whose status was `dead` in **every** run they appeared in
3. Merges them into `data/dead-urls.json` (deduped, sorted)
4. Prints a summary of how many new hosts were added

The script is **idempotent** - running it twice produces no change. You can add it as a post-run step or run it manually whenever you want to prune the dead list.

`data/dead-urls.json` is committed to the repo so the dead list is shared with all clones.

---

## Removing a schedule from an older version

This fork never schedules runs. If you ran setup from an earlier version and said yes to the monthly schedule, remove it:

| Platform | Command |
|----------|---------|
| **macOS** (launchd) | `launchctl unload ~/Library/LaunchAgents/com.upec-wipe.plist` then `rm ~/Library/LaunchAgents/com.upec-wipe.plist` |
| **Linux** (systemd) | `systemctl --user disable --now upec-wipe.timer` then `rm ~/.config/systemd/user/upec-wipe.{service,timer}` |
| **Linux** (crontab fallback) | Run `crontab -e` and delete the `upec-wipe` line |
| **Windows** (schtasks) | `schtasks /Delete /TN upec-wipe /F` |

---

## International users

This tool supports non-US users with a few important caveats.

### What works

- `setup.js` will prompt for **Country** (2-letter ISO code, e.g. `CA`, `GB`, `AU`) and then replace the US-centric "State" / "ZIP code" prompts with **Province/Region** and **Postal code** prompts that accept any format (`K1A 0A6`, `SW1A 1AA`, `2000`, etc.) with no coercion.
- Phone numbers for non-US users are stored verbatim - no `(xxx) xxx-xxxx` reformatting is applied.
- `lib/forms.js` automatically tries province/postal/postcode HTML field variants (e.g. `input[name*="province"]`, `input[name*="postcode"]`) when filling forms for non-US users, with no change needed in broker definitions.
- A country `<select>` on opt-out forms is targeted and filled with your 2-letter country code when present.
- Global brokers (ZoomInfo, Clearbit, Acxiom, Radaris, etc.) are attempted for all users.

### US-only brokers (automatically skipped for non-US users)

The following brokers are flagged `usOnly: true` and are silently skipped when your configured country is not `US`. These sites index US public records, voter data, or phone directories - a non-US person definitionally has no record to remove there:

| Broker | Reason |
|--------|--------|
| Spokeo | US people-search (state-keyed search) |
| WhitePages | US white-pages directory |
| FastPeopleSearch | US people-search |
| TruePeopleSearch | US people-search |
| BeenVerified | US background-check (requires US state) |
| USPhonebook | US phone directory |
| PublicDataUSA | US public records |

All other brokers in the list are attempted regardless of country.

### What won't help much

US people-search sites (`Spokeo`, `WhitePages`, etc.) hold records sourced from US public records - if you have never lived in the US, your data is very unlikely to appear on these sites. The script skips them for you automatically.

---

## Is it safe to submit my info to 500 opt-out forms?

A fair concern raised by some users: aren't you just confirming your data to the brokers by filling out their forms?

A few things worth knowing:

- **These brokers already have your info.** You're not revealing anything new - you're using the legally-required removal mechanism they're obligated to provide.
- **CCPA (California) and similar state laws require brokers to honor opt-out requests.** Submitting the form creates a legal obligation to remove you. Doing nothing does not.
- **The script uses info you're already listed under** - your name as it appears publicly, your state, your email. It doesn't add new data points.
- **The alternative is worse.** Every month that passes, more brokers scrape and resell your data. Opt-outs are imperfect, but they work more often than not.

That said: if you're in a situation where even confirming your email address to a broker is a risk, this tool is not the right approach. Consider a paid service that uses a proxy email.

---

### California residents: DROP delete portal (SB 362)

California's Delete Request and Opt-out Platform (DROP), established by SB 362,
will eventually let residents submit a single deletion request that all
California-registered data brokers must honor. The platform is operated by the
California Privacy Protection Agency (CPPA).

**Status as of late 2025: not yet live.** The broker-side compliance deadline
in SB 362 is August 1, 2026. CPPA has missed several preceding milestones and
ongoing litigation (Data Brokers Association v. Bonta) may further delay things.

See: https://cppa.ca.gov/data_broker_registry/

Until DROP is live, this tool falls back to per-broker opt-out flows for
California-registered brokers.

---

## Why not just use a paid service?

Paid services like [Incogni](https://incogni.com) ($96/yr) or [Optery](https://optery.com) ($39/yr) are excellent and cover more brokers with professionally maintained opt-out flows. This tool is for people who want full control, transparency, and no recurring subscription - or who want to handle the gaps those services miss (Acxiom, LexisNexis, ZoomInfo, Clearbit).

Using both is the strongest approach: a paid service for the bulk of brokers + this script for the gaps.

---

## Security, and how this code is reviewed

`config.json` holds your legal name, home address, phone, date of birth and API
keys. If you find a way for any of that to escape - into a log, a report, the
wrong form field, another local user, or a site chosen by a remote registry -
please report it privately rather than in an issue. See
[SECURITY.md](SECURITY.md).

Most of this codebase was written by an AI model, and the review loop originally
used the same model family, which [issue #8][i8] correctly called an echo
chamber. Files that touch PII, crypto, subprocesses or untrusted network input
now require a review from a *different* model family before merge, and CI builds
the Docker image and launches a real browser rather than grepping the Dockerfile.
The policy, the tooling, and an honest account of what that does and does not buy
you are in [docs/CROSS_MODEL_REVIEW.md](docs/CROSS_MODEL_REVIEW.md).

```bash
npm run review:cross-model        # review the current diff with a non-Anthropic model
```

[i8]: https://github.com/stephenlthorn/auto-identity-remove/issues/8

---

## License

MIT - see [LICENSE](LICENSE). UPEC-WIPE is a fork of [auto-identity-remove](https://github.com/stephenlthorn/auto-identity-remove), copyright (c) 2026 Stephen Thorn; the fork's changes are copyright (c) 2026 the UPEC-WIPE contributors. Both notices are kept in LICENSE, as the MIT license requires.
