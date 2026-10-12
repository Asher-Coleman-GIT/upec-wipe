# Reviewing the site catalog

The catalog (`data/catalog/`) holds one record per site from the generic lists. A record only runs once it is **reviewed**. This is the procedure.

## 1. Candidates and the first survey

    node scripts/catalog-candidates.js
    node scripts/catalog-survey.js            (headless, read-only, Mullvad on; resumable with --resume)

Each site is grouped: dead, blocked, people-search, business or unknown.

## 2. The assisted sitting

    ASSIST=1 WAIT=8000 node scripts/catalog-survey.js --group blocked

A window opens for each blocked site. Complete the bot check; the survey records the page and moves on. It never clicks, types or submits anything for you.

## 3. Review batches

    node scripts/catalog-batch.js --size 20

For each site in the batch, edit its record's `review`:

- `"state": "reviewed"` with a `definition` (method, optOutUrl, formFields, submitSelector, captchaLikely, requires), or
- `"state": "manual"` with `optOutUrl` and `notes` when a person has to do it, or
- `"state": "excluded"` when the site is not about individuals.
- `"state": "email"` for a business broker that takes requests by email (phase 2). It needs `to` (one of the addresses in `survey.contacts`) and `basis`: `kind` (`utah` when the policy names Utah, `all-us` when it honors every US resident), `quote` (the sentence, at most 400 characters, no address) and `url` (https, on the broker's domain). A broker with a usable privacy web form is `reviewed` instead.

Values are tokens: `{firstName}`, `{lastName}`, `{fullName}`, `{email}`, `{city}`, `{state}`, `{stateName}`, `{zip}`, `{dobMonthName}`, `{dobDay}`, `{dobYear}`. The only literals allowed are `on` and option values the survey recorded for a dropdown. Never type a real value. URLs may not contain `{email}` at all, and identity query parameters (`first`, `name`, `q`, `zip`...) must be tokens. Definition URLs must be on the site's own domain or on a platform listed in the record's `formHosts` (for example a broker whose privacy form is hosted on `onetrust.com`). At run time a reviewed site whose page lands anywhere else is listed as manual and nothing is filled.

Rules learned from the 2026-10 surveys:

- Fill only the opt-out form. Scope selectors to it when the page has more than one form (`form:has(button:has-text("Send Request")) ...`).
- Never fill a header search box, a newsletter box or a marketing signup.
- Tick consent or authorisation boxes only when the request needs them; never promotional ones.
- Two-step sites (an emailed link opens the real form) fill only step one.
- A form that needs a birth date lists `"requires": ["dob"]`.
- An embedded third-party form whose required fields cannot be reached becomes `manualAfterSearch` or `manual`.

## 4. Prove the batch

    node bin/aidr.js preview --only "Site One,Site Two"

A record stays `reviewed` only if its preview fills the intended fields and names the submit target. Otherwise make it `manual` or put it back to `unreviewed` with a note. Then run `npm test` (every record must validate and hold no personal data) and commit the batch.

## 5. Keeping it current

    node bin/aidr.js catalog-check

Re-checks reviewed sites. A site whose page moved, lost a field or gained a bot check becomes `needs-review` and runs as manual until it is reviewed again.
