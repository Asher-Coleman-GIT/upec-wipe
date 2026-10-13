# UPEC-WIPE reference

Details that do not fit on the front page. For setting up and running the tool step by step, read [UPEC-MANUAL.md](UPEC-MANUAL.md) first. Commands are shown as `upec-wipe <command>`; without `npm link`, type `node bin/upec-wipe.js <command>`.

- [Run results and state](#run-results-and-state)
- [Verifying removals](#verifying-removals)
- [Search-engine monitoring](#search-engine-monitoring)
- [Brokers covered](#brokers-covered)
- [Adding a broker](#adding-a-broker)
- [CapSolver](#capsolver)
- [Docker](#docker)
- [Environment variables](#environment-variables)
- [Maintenance](#maintenance)
- [Removing a schedule from an older version](#removing-a-schedule-from-an-older-version)
- [International users](#international-users)
- [Retired commands](#retired-commands)
- [Is it safe to submit my details to brokers?](#is-it-safe-to-submit-my-details-to-brokers)
- [California DROP portal](#california-drop-portal)
- [Why not a paid service?](#why-not-a-paid-service)

---

## Run results and state

`state.json` records when each broker was last opted out of. The re-check window is **90 days**: brokers often add you back within that time, so the tool submits again once it is due. `state.json` is gitignored and stays on your machine.

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

Every write goes to a temporary file first and then replaces `state.json`, and a `.bak` copy is kept. If a save cannot be done safely, the run stops with an error rather than leaving a half-written file.

Each run ends with a summary in these groups:

| Status | Meaning |
| --- | --- |
| `Submitted (form accepted)` | The opt-out form was submitted this run. |
| `Awaiting email confirm` | The broker said "check your email to confirm". Click the link in your inbox. Retried after 14 days if still pending. |
| `Skipped` | Not attempted this run: done recently, waiting on a confirmation, on your allowlist, US-only for a non-US person, or a dry run. |
| `Previewed (not submitted)` | A preview filled the form and sent nothing. |
| `Not listed` | Your name was not found on that site. |
| `Manual needed` | Listed under Action Required for you to finish by hand. |
| `Errors` | Network or timeout problem. Tried again next run. |
| `Dead (stale URL)` | The broker's page is gone (DNS failure or 404). Not counted as an error. Only the retired generic pass reported it, so it now stays at 0. |

**Submitted does not mean deleted.** See [Verifying removals](#verifying-removals) and [STATUS.md](../STATUS.md).

To forget the history, use `upec-wipe clear-all` (it deletes `state.json` with everything else); `upec-wipe clear` keeps it.

Email requests (`run --email`) keep their own record per broker: when the email was sent and the reply you logged with `upec-wipe reply <broker> honored|refused|verify|none|bounced`. `upec-wipe list` shows both.

---

## Verifying removals

```bash
upec-wipe verify
```

Opens a browser, searches each broker where an opt-out was recorded, and reports what it finds. It submits nothing. Results are grouped into:

| Section | Meaning |
| --- | --- |
| `VERIFIED CLEAR` | Your name was not found in the broker's search today. |
| `STILL LISTED` | A listing was found: the opt-out failed, or the broker added you back. |
| `UNVERIFIABLE` | The broker uses a direct form, email or manual method, so there is no search to check. |

A dated report is saved to `logs/verify-YYYY-MM-DD.json`.

- Only `search-form` brokers (with a `searchUrl` and `listingPattern`) can be checked automatically.
- "Verified clear" means one search today found nothing. It is not proof of deletion.
- A broker whose search page is down or slow counts as `unverifiable`, never as `still listed`.
- Running `upec-wipe run` again tries removal again where you are still listed.

---

## Search-engine monitoring

`upec-wipe serp-watch` searches DuckDuckGo, Bing and Google for `"<your full name>" "<city>, <state>"`, compares the broker domains that rank with the previous snapshot in `data/serp-history.json`, and lists domains where your name is new. It sends your full name and city to those search engines, through the VPN, and runs only when you start it.

---

## Brokers covered

UPEC-WIPE works through two sources, in this order.

### 1. Explicit brokers (`brokers.js`)

32 hand-mapped brokers with their own selectors: 11 direct forms, 4 search-then-remove forms, 2 email brokers and 15 manual (opened for you). [STATUS.md](../STATUS.md) has the per-broker table, with method, CAPTCHA, US-only and confidence. **None is marked `verified`**: a read-only survey on 2026-10-10 re-read the live forms, but none has been tested end to end. Some have moved or died (NationalPublicData is defunct, Clearbit moved to HubSpot); STATUS.md lists them.

### 2. Reviewed site catalog (`data/catalog/`)

Every site from the public broker lists was surveyed and reviewed, one JSON file per site, about 640 in all. Each record says what the tool does with the site:

- **People-search sites** are reviewed by hand into automatic forms (a few need your date of birth), manual links, or exclusions where a parent company's opt-out already covers them.
- **Business data brokers** get an email request when their privacy policy names Utah or honors all US residents and they hold consumer data. The policy sentence that gives the right is stored with the record. The rest are manual or excluded.
- **Dead or blocked sites** are recorded so they are not visited again. `upec-wipe catalog-check` re-reads reviewed sites and flags any whose opt-out page changed.

Catalog sites run after the explicit brokers, with the same checks and status words. Records hold tokens such as `{firstName}`, never real values. See [CATALOG-REVIEW.md](CATALOG-REVIEW.md) for how sites are surveyed and reviewed.

### Retired: the generic pass

Earlier versions had an opt-in heuristic pass (`--generic`) over the sites from The Markup, BADBOOL and the state registries that had no hand-mapped broker. The reviewed catalog now covers those lists, and the pass matched sites by their opt-out page's host rather than the broker's own domain, so it re-submitted to brokers the catalog handles or excludes. It was retired on 2026-10-13. `--generic`, or `generic.enabled: true` in `config.json`, now stops with "The generic pass was retired" and sends nothing; remove the flag or the `generic` block. With an encrypted config, run `node watcher.js --decrypt-config`, remove the block, then `node watcher.js --encrypt-config`. The source lists stay as catalog inputs.

### Manual only

| Site | Why manual |
| --- | --- |
| Google - Results About You | Needs your Google account |
| Google - Outdated Content | Case-by-case URL submission |

### How much to trust the counts

Broker sites change their pages constantly, and a selector that no longer matches fails quietly. That is the central limit of the whole approach. A form the tool cannot fill is never submitted, and sites behind bot protection are listed for you to do by hand (`--assist` lets you clear a bot check yourself and the run carries on).

---

## Adding a broker

Add an entry to `brokers.js`:

```js
{
  name: 'NewBrokerSite',
  method: 'direct-form',           // or 'search-form', 'email', 'manual'
  optOutUrl: 'https://example.com/opt-out',
  formFields: {
    'input[name*="first" i]': F,   // F, L, N, E, ST, Z are filled from config
    'input[name*="last"  i]': L,
    'input[type="email"]':    E,   // always the relay alias, never the real email
  },
  submitSelector: 'button[type="submit"]',
  captchaLikely: false,
  priority: 2,
}
```

To prove the selectors, dry-fill the form with the dummy person from `config.example.json` through `fillForm` in `lib/forms.js`. Do not run `preview` with your real details just to test a selector. Then run `npm test`. For sites from the public lists, add a catalog record instead; see [CATALOG-REVIEW.md](CATALOG-REVIEW.md).

---

## CapSolver

A few opt-out pages have a CAPTCHA. With a [CapSolver](https://capsolver.com) key (pay as you go, about $0.001 per solve) the tool solves them; without one, those brokers are listed for you to finish by hand. `--no-capsolver` skips CapSolver for one run.

```json
"capsolver": {
  "apiKey": "CAP-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

CapSolver sees your account and the address of each broker page that showed a CAPTCHA, and gets none of your details. Its connection passes the same Mullvad check as everything else.

---

## Docker

The `Dockerfile` uses the official Playwright image, so Chromium and its system libraries are included. It builds for `linux/amd64` and `linux/arm64`; the amd64 image is about 940 MB. The compose file runs as `pwuser` with all capabilities dropped and `no-new-privileges`; see [FORK.md](../FORK.md) for what is still to verify on a Docker host.

```bash
# Build the image (once)
docker build -t upec-wipe .

# Preview: checks reachability and fills forms, submits nothing
docker run --rm --init \
  -v "$(pwd)/config.json:/app/config.json" \
  -v "$(pwd)/state.json:/app/state.json" \
  -v "$(pwd)/logs:/app/logs" \
  -e TZ="$(date +%Z)" \
  upec-wipe node watcher.js --preview

# Full run
docker run --rm --init \
  -v "$(pwd)/config.json:/app/config.json" \
  -v "$(pwd)/state.json:/app/state.json" \
  -v "$(pwd)/logs:/app/logs" \
  -e TZ="$(date +%Z)" \
  upec-wipe
```

Or with compose: `docker compose run --rm watcher node watcher.js --preview`.

- **Create `state.json` before the first run** (`touch state.json`). If the path does not exist, Docker creates a directory there and the run fails with `EISDIR`.
- **Use `--init`.** Without it node is PID 1, `docker stop` cannot reap the Chromium children, and the state lock is left behind.
- **Set `TZ`.** Containers are UTC; without it log timestamps are in the wrong hour.
- **Prefer mounting a directory over single files.** `rename()` onto a single-file bind mount fails with `EBUSY`. A fallback keeps state working, but it gives up crash safety. To keep it, mount a directory:

  ```bash
  docker run --rm --init \
    -v "$(pwd):/app/data" \
    -e UPEC_WIPE_STATE_PATH=/app/data/state.json \
    upec-wipe
  ```

- **Low-RAM hosts** (NAS, Raspberry Pi, small VPS): add `-e UPEC_WIPE_LOW_MEMORY=1`. A full run peaks at about 250 MB either way; the flag trades some render fidelity for less background work.

Synology and other NAS users: see [SYNOLOGY.md](SYNOLOGY.md).

---

## Environment variables

| Variable | Effect |
| --- | --- |
| `UPEC_WIPE_PASSPHRASE_FILE` | File holding the passphrase that encrypts `config.json` at rest (AES-256-GCM). Default `~/.config/upec-wipe/passphrase`. Keep it off the disk or backup it protects. |
| `UPEC_WIPE_PASSPHRASE` | The passphrase itself. Prefer the file. |
| `UPEC_WIPE_STATE_PATH` | Where `state.json` lives. |
| `UPEC_WIPE_LOW_MEMORY` | `1` lowers browser background work on small hosts. |
| `UPEC_WIPE_DEBUG` | `1` prints where a `Fatal:` error came from (file and line, with account names and URL queries removed). Include it when you ask for help. |
| `CA_REGISTRY_URL`, `VT_REGISTRY_URL` | Override the registry URLs used by `scripts/update-catalog-sources.js`. |

---

## Maintenance

### Refreshing the broker registries

```bash
node scripts/update-catalog-sources.js
```

Fetches the California (SB 362) and Vermont data-broker registries over HTTP (no browser, through the Mullvad check), dedups them against `brokers.js`, and writes `data/feeds-brokers.json`, which `scripts/catalog-candidates.js` reads with the bundled lists to find sites for the catalog. Entries that are not `https` are dropped.

### The dead-site list

`data/dead-urls.json` lists hosts the catalog candidate builder skips. It was built from runs of the generic pass, which was retired; nothing a run does today adds to it. Dead sites are now recorded by the catalog survey instead (the `dead` group in `data/catalog/`). `node scripts/prune-dead.js` still merges hosts that were dead in every old `logs/run-*.json` it finds, and running it twice changes nothing.

### Pulling upstream changes

See [FORK.md](../FORK.md): read the whole upstream diff, merge by hand, and record the reviewed commit in `UPSTREAM_BASE`.

---

## Removing a schedule from an older version

UPEC-WIPE never schedules runs. If an earlier version of setup installed a monthly job, remove it:

| Platform | Command |
| --- | --- |
| **macOS** (launchd) | `launchctl unload ~/Library/LaunchAgents/com.upec-wipe.plist` then `rm ~/Library/LaunchAgents/com.upec-wipe.plist` |
| **Linux** (systemd) | `systemctl --user disable --now upec-wipe.timer` then `rm ~/.config/systemd/user/upec-wipe.{service,timer}` |
| **Linux** (crontab) | `crontab -e` and delete the `upec-wipe` line |
| **Windows** (schtasks) | `schtasks /Delete /TN upec-wipe /F` |

---

## International users

- Setup asks for a **Country** (2-letter code such as `CA`, `GB`, `AU`) and then asks for **Province/Region** and **Postal code** in any format, instead of State and ZIP.
- `lib/forms.js` tries province, postal and postcode field names for non-US people, and fills a country `<select>` with your code when there is one.
- Brokers marked `usOnly: true` (US people-search, phone directories and public-record sites such as Spokeo, WhitePages, FastPeopleSearch, TruePeopleSearch, BeenVerified, USPhonebook and PublicDataUSA) are skipped when your country is not `US`. Global brokers are tried for everyone.
- Email requests cite US state law (the Utah Consumer Privacy Act for Utah residents), so they are aimed at US residents.

---

## Retired commands

Each prints one line saying it was removed and exits without doing anything.

| Command | Why it went | Use instead |
| --- | --- | --- |
| `know` | It cited California law (CCPA) for every non-EU member, which does not apply to Utah residents, and sent your phone number. | The email requests (`run --email`) ask for deletion under Utah law. |
| `complaints` | Same California-law problem: it drafted complaints to the wrong regulator. | File with the Utah Division of Consumer Protection yourself if a broker ignores a request. |
| `breach` | It sent your real email to Have I Been Pwned and needed a paid key. | Check haveibeenpwned.com yourself. |
| `score` | Built mostly from the breach check. | `verify` and `serp-watch`. |
| `report` | A PDF of the score. | `list` and `verify`. |
| `freeze` | A checklist that sent nothing. | The manual's "Credit and identity freezes" section. |
| `snapshot` | Saved screenshots of forms with your details. | Nothing. |
| `confirm-emails` | Clicked links from exported emails unattended. | Click confirmation links yourself. |
| `serp` | `serp-watch` does the same search and lists what is new. | `serp-watch`. |
| `dashboard` | Could not run the email step or log replies, and was the largest attack surface. | The CLI. |
| `update-brokers` | Maintainer work since the generic pass was retired. | `node scripts/update-catalog-sources.js`. |

---

## Is it safe to submit my details to brokers?

A fair worry: does filling in an opt-out form confirm your data to the broker?

- **The brokers already have it.** The tool sends what you are already listed under (name, city, state, ZIP), through the removal process they are required to offer.
- **No new contact details.** Forms get a SimpleLogin alias, never your real email; if no alias can be made, nothing is submitted. Email requests come from a dedicated mailbox, not your everyday one.
- **No new location.** Nothing leaves your machine unless Mullvad is connected, so brokers see a VPN address, not your home IP.
- **The law is on your side** where it applies: CCPA, the Utah Consumer Privacy Act and similar laws oblige brokers to act on requests. Doing nothing obliges them to nothing.

What still leaks, and to whom, is in [THREAT-MODEL.md](THREAT-MODEL.md) and [PRIVACY.md](PRIVACY.md). If even an alias tied to your name is a risk for you, do not use this tool.

---

## California DROP portal

California's Delete Request and Opt-out Platform (DROP), from SB 362, is meant to let residents send one deletion request that every California-registered broker must honor. It is run by the California Privacy Protection Agency and is for California residents only. SB 362 required brokers to start processing its requests by August 1, 2026; check https://privacy.ca.gov/drop/ for its current status. It is listed in `brokers.js` as a manual site ("California DROP"), and this tool's per-broker requests cover everyone else.

---

## Why not a paid service?

Paid services such as [Incogni](https://incogni.com) and [Optery](https://optery.com) cover more brokers with maintained flows. UPEC-WIPE is for people who want full control, can read every request it sends, and want no subscription or third party holding their details. Using both works too: a paid service for the bulk, this tool for the gaps.
