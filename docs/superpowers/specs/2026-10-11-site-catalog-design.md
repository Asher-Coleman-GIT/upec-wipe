# Reviewed Site Catalog - Design

Date: 2026-10-11
Branch: `upec/hardening`
Status: approved in conversation, section by section; awaiting review of this written spec

## Goal

Turn the roughly 500 sites the generic pass guesses at (The Markup's 2023
data-broker list, BADBOOL, and the California and Vermont registries) into
reviewed definitions that run the way the 32 brokers in `brokers.js` do: each
site checked against its live opt-out page, filled only where the form is
understood, and flagged again when the site changes.

The member chose (2026-10-11):

- **Goal (c):** people-search sites first (phase 1, this spec), business data
  brokers by email afterwards (phase 2, outlined here, specified separately).
- **Review method (b):** one assisted sitting in which the member clears bot
  checks for every people-search site that shows one.
- **Approach 1:** a reviewed site catalog in `data/catalog/`, not more entries
  in `brokers.js` and not a smarter `--generic`.
- **Phase 2 mail route (a):** send from the SimpleLogin alias through Gmail
  SMTP and SimpleLogin reverse aliases.

Success for phase 1:

1. Every candidate site has a catalog record with a group (dead, business,
   people-search) and the date it was checked.
2. Every people-search site is either reviewed and runnable, or a manual entry
   with a working link and instructions.
3. Reviewed sites run through the same runner path and safety checks as the
   32 brokers, and each review batch is proven by a live `preview`.
4. Re-running the survey flags any reviewed site whose page changed, and that
   site is treated as manual until re-reviewed.
5. `--generic` never touches a site the catalog knows.

## Global constraints

- Node 22, CommonJS, `node:test`. No new runtime dependencies.
- Every network request goes out through the Mullvad gate (`ensureNodeEgress`
  for Node requests, the existing browser egress check for Playwright).
- Surveys are read-only: they open pages and follow links by URL, and never
  click buttons, tick boxes, type into fields or submit forms. They use the
  dummy person (Jane Doe, Austin TX), never `config.json`.
- No personal data in any tracked file. Catalog records hold value tokens such
  as `{firstName}`, never values. Run-time values come from config, exactly as
  `brokers.js` does.
- The real email is never typed into any form or request. Email fields receive
  the relay alias. The existing value-based swap in `lib/forms.js` applies.
- Output stays plain text with no emoji. Tracked files contain no em or en
  dashes (`test/no-em-dashes.test.js`).
- Every change is test-first, and the full suite passes before each commit.

## Architecture

```
sources ──> candidates.json ──> triage survey ──> data/catalog/<domain>.json
 (Markup,     (merged, deduped      (headless,          (unreviewed)
  BADBOOL,     by domain)            read-only)               │
  CA, VT)                                                     ▼
                                            assisted survey (member clears checks)
                                                              │
                                                              ▼
                                        review batches (definition + reviewed mark)
                                                              │
                                                              ▼
                     runner: brokers.js (32) then reviewed catalog sites, same path
```

### Units

| Unit | File | Responsibility |
|---|---|---|
| Source loaders | `lib/feeds.js` (fixed), `lib/catalog-sources.js` (new) | Read Markup, BADBOOL and the two registries into `{ name, url, source }` rows. |
| Candidate builder | `scripts/catalog-candidates.js` (new) | Merge rows, dedupe by registrable domain, drop the 32 explicit hosts and known-dead hosts, write `data/catalog/candidates.json`. |
| Triage survey | `scripts/catalog-survey.js` (new, reuses `inspect-broker-forms.js` page dump) | Visit each candidate, write or update its catalog record. Resumable. Supports `ASSIST=1`. |
| Catalog record schema and loader | `lib/catalog.js` (new) | Validate records, turn reviewed records into broker objects for one person. |
| Runner integration | `watcher.js`, `lib/broker-runner.js` | Run reviewed catalog sites after the 32 through `processBroker`. |
| Drift check | `lib/catalog-drift.js` (new) | Compare a fresh survey result with a reviewed record and decide whether it needs review. |
| Generic exclusion | `generic-runner.js` | Skip every host present in the catalog. |

### Sources

- **The Markup** (`data/markup-parsed.json`, 494 rows) and **BADBOOL**
  (`data/badbool-extra.json`, 27 URLs) are already in the repo.
- **California registry.** `https://oag.ca.gov/data-brokers/csv` returned HTTP
  403 on 2026-10-11. The registry is now run by the California Privacy
  Protection Agency. The first task finds the current download (the CPPA data
  broker registry page), verifies it returns CSV through Mullvad, and updates
  `CA_REGISTRY_URL`. If no machine-readable download exists, the task records
  that in `STATUS.md` and the candidate list proceeds without California.
- **Vermont registry.** The export URL returned an HTML page on 2026-10-11.
  Same treatment as California.
- The registry parsers keep the existing header aliases and also read an email
  contact column when present (kept for phase 2).

### Catalog record

One JSON file per site, `data/catalog/<domain>.json`, tracked in git:

```json
{
  "domain": "example-people.com",
  "name": "Example People",
  "sources": ["markup", "ca-registry"],
  "group": "people-search",
  "survey": {
    "checkedAt": "2026-10-12T03:00:00Z",
    "status": 200,
    "block": null,
    "optOutUrl": "https://example-people.com/opt-out",
    "fingerprint": "sha256 of the sorted control list",
    "controls": [{ "tag": "input", "type": "text", "id": "first", "name": "first", "placeholder": "", "label": "First name", "form": 0, "heading": "Opt out" }],
    "captcha": true,
    "contacts": ["privacy@example-people.com"]
  },
  "review": {
    "state": "reviewed",
    "reviewedAt": "2026-10-13",
    "note": "Single form; consent box required.",
    "definition": {
      "method": "direct-form",
      "optOutUrl": "https://example-people.com/opt-out",
      "formFields": { "#first": "{firstName}", "#last": "{lastName}", "#email": "{email}", "#consent": "on" },
      "submitSelector": "form button:has-text(\"Remove\")",
      "captchaLikely": true,
      "requires": [],
      "usOnly": true
    }
  }
}
```

- `group`: `dead`, `blocked`, `business`, `people-search`, `unknown`.
- `review.state`: `unreviewed` (default), `reviewed`, `manual`,
  `needs-review`, `excluded`. Only `reviewed` records with a `definition` run
  as forms. `manual` records carry `optOutUrl` and `notes` and appear under
  Action Required. Every other state does nothing at run time.
- `definition.method`: `direct-form`, `search-form` (with `searchUrl` and
  `listingPattern` as a string, compiled at load), or `manual`. It may also set
  `manualAfterSearch`.
- **Value tokens:** `{firstName}`, `{lastName}`, `{fullName}`, `{email}`,
  `{city}`, `{state}`, `{zip}`, `{dobMonthName}`, `{dobDay}`, `{dobYear}`.
  Any other value must be a literal from an allow list: `on`, or an option
  value recorded in `survey.controls` for that select. A record whose form
  uses a `{dob...}` token must list `dob` in `requires`.
- `survey.contacts` is the only place email addresses appear, and only the
  site's own published addresses.

### Loader rules (`lib/catalog.js`)

- `loadCatalog(dir)` reads every record and validates it. A record that fails
  validation is skipped with one plain-text warning naming the file and the
  rule. It never throws for one bad record.
- Validation: `domain` matches the file name; every URL is `https:`; the
  definition's URLs are on `domain` or a subdomain; a form definition fills at
  least one of `{firstName}`, `{lastName}`, `{fullName}`, `{email}`;
  `listingPattern` compiles; tokens and literals follow the rules above.
- `catalogBrokersForPerson(records, person)` returns broker objects in the
  same shape `brokers.forPerson()` returns, with tokens resolved from the
  person (state codes and names through `lib/us-state.js`, birth date through
  `lib/dob.js`). Each carries `source: 'catalog'` and `reviewedAt`.

### Runner integration

- `watcher.js` appends `catalogBrokersForPerson(...)` after
  `brokers.forPerson(person)` and passes each through the existing
  `processBroker`. No catalog-specific branch exists in `broker-runner.js`;
  every protection (empty-form guard, block detection, `--assist`, alias swap,
  `requires`, `manualAfterSearch`, state name matching, the reveal wait,
  preview redaction) applies unchanged.
- `--only` and `--skip` match catalog names. The 90-day re-check, state keys
  and the summary are shared.
- A catalog site whose domain matches one of the 32 is dropped at load: the
  hand-tuned entry wins.
- `--list` and the dashboard show catalog sites with their review date and
  state.

### Surveys

- `scripts/catalog-survey.js [--group people-search] [--only <domain>] [--resume]`
  visits candidates, writes `survey` and `group`, and never touches `review`
  except to set `needs-review` (drift, below).
- Finding the opt-out page: start at the listed URL; if it has no form with a
  name or email field, follow up to 3 same-site links whose text or URL
  matches `opt.?out|do not sell|remove|suppress|privacy request|delete` and
  keep the first page that has one. Navigation is by `page.goto(href)`, never
  a click.
- Grouping: `dead` (DNS failure, 404, 410), `blocked` (block page after any
  assist), `people-search` (title or text matches `people search|background
  check|public records|find people|phone lookup|address lookup`, or the page
  has a name search box), otherwise `business`. The member can overrule any
  group during review.
- `ASSIST=1` runs headed and waits for the member at solvable checks
  (`lib/assist.js`). The assisted sitting covers people-search records whose
  `group` is `blocked` or whose `survey.block` is solvable.
- Progress is written after each site, so an interrupted survey resumes with
  `--resume`.

### Review batches

- About 20 people-search records per batch. For each, the reviewer (Claude,
  with the member's approval of each batch) writes `review.definition`, or
  sets `manual` with instructions, following the rules learned in the
  2026-10-10 and 2026-10-11 surveys:
  - fill only the opt-out form, scoping selectors to that form when a page
    holds several (PeopleFinders);
  - never fill a header search box, newsletter or marketing form (TruePeopleSearch, DataAxle);
  - tick consent or authorisation boxes only when the request needs them,
    never promotional ones;
  - two-step sites (emailed link) fill only step one;
  - forms needing a birth date list `requires: ['dob']`;
  - embedded third-party forms whose required fields cannot be reached become
    `manualAfterSearch` or `manual` (MyLife).
- Proof: `aidr preview --only <batch names>` with Mullvad on. A record moves
  to `reviewed` only if its preview fills the intended fields and finds the
  submit control. Others become `manual` or stay `unreviewed` with a note.
- One commit per batch, after the pre-push personal-data scan.

### Drift

- `lib/catalog-drift.js` compares a fresh survey with a `reviewed` record:
  changed `optOutUrl` host or path, a missing selector from the definition, a
  new block page, or a changed control fingerprint.
- A drifted record becomes `needs-review` with the reason in `review.note`.
  At run time `needs-review` behaves as `manual` with the reason and link.
- `aidr catalog-check` (new subcommand) runs the survey over reviewed records
  only and prints what drifted.

### Generic pass

- `generic-runner.js` adds every catalog domain, in any state, to the
  exclusion set it already builds from the 32 explicit hosts.
- `--generic` stays off by default. Removing it after phase 1 is a separate
  decision for the member.

## Error handling

- A site that throws during the survey gets `group: unknown` and the error's
  first line in `survey.error`; the survey moves on.
- An unreadable catalog directory at run time prints one warning and the run
  continues with the 32 brokers.
- Registry downloads over 5 MB or not CSV are refused with a clear message
  (existing behaviour in `lib/feeds.js`).

## Testing

Test-first for each unit:

- source loaders: registry CSV with an email column; HTML instead of CSV is refused;
- candidate builder: dedupe by registrable domain, explicit and dead hosts dropped;
- loader validation: each rule has a failing record test; a bad record is skipped, not fatal;
- token resolution: names, state code and name, birth date, missing values left empty;
- tracked-files check: no catalog record contains any value from `config.example.json`'s person, and only `survey.contacts` holds email addresses;
- runner: a reviewed catalog site goes through `processBroker` with the empty-form guard and alias swap, `needs-review` logs manual, the 32 win on domain clashes;
- drift: each drift reason flips `reviewed` to `needs-review`; an unchanged page does not;
- generic exclusion: a catalog domain is never visited by the generic pass;
- survey script: read-only (no click, check, fill or submit calls), dummy person, egress gate first, `--resume` skips finished sites.

## Phase 2 outline (separate spec)

Business brokers from the catalog with `survey.contacts`: deletion requests by
email from the SimpleLogin alias. The tool creates a SimpleLogin reverse alias
per broker contact and sends through Gmail SMTP with an app password; the
broker sees only the alias. Needs: confirming SimpleLogin's plan allows
sending from an alias, a narrow tested exception to the rule that refuses SMTP
whose sender is the real address while a relay is on, rate limiting, and
tracking replies. Utah residents have weak legal leverage, so refusals are
expected and recorded, not retried.

## Out of scope

- Phase 2 implementation.
- Removing `--generic`.
- Searching sites by the member's real email (declined 2026-10-11).
- Street address collection (declined 2026-10-11).
