# Broker Status

> **Reality check:** A broker is `verified` only after a member ran it end to end on the live site; every other entry may have drifted. The selectors compile and the test suite verifies their internal structure, but only the `verified` entries have been run end to end. Many of these sites change their DOM frequently - selectors decay.
>
> **What "untested" means:** the broker entry is structurally valid but has not been hand-verified against the live site recently. The opt-out attempt will be made but may silently fail if the site has changed its form.
>
> **Brokers known to be dead or moved as of late 2025:**
> - **NationalPublicData**: defunct (Aug 2024 SSN breach + Oct 2024 bankruptcy). Listing kept for historical reference; opt-out flow does not work.
> - **Clearbit**: acquired by HubSpot (Nov 2023). Opt-out moved to hubspot.com/data-privacy/data-rights-form.
> - **Acxiom**: live but requires multi-step identity verification at acxiom.com/about-us/privacy/. Single-form POST will fail.
> - **LexisNexis Risk Solutions**: requires a fillable PDF mailed/faxed + a separate portal at consumer.risk.lexisnexis.com. Single-form POST will fail.
> - **ZoomInfo**: opt-out is at privacy.zoominfo.com/profile/edit-or-delete behind email verification.
>
> If you encounter a broker that has changed its form, please file a GitHub issue with the broker name and the new form layout.

**Last updated:** 2026-10. This table is kept by hand: update it when you edit `brokers.js`.

## How to read this

- **Method** - how the opt-out is automated. `search-form` (looks you up first, then submits removal), `direct-form` (goes straight to the opt-out URL), `email` (sends a removal-request email), `manual` (opened in your browser).
- **CAPTCHA** - whether CapSolver is invoked before submit.
- **Confidence** - `failed` means a real run did not get the request in. `submitted` means a real run's form was accepted but the final step (such as a confirmation email) is still open. `surveyed 2026-10` means the selectors were read from the live opt-out page on 2026-10-10 (no submit). `verified` means the selectors / flow have been manually confirmed against the live site. `untested` means the entry exists but has not been hand-verified end-to-end and depends on the broker not having changed its DOM.
- **US-only** - site indexes US public records / voter data / phone directories; automatically skipped for non-US users.

**This list covers the 32 explicit brokers in `brokers.js` only.** Sites from the public broker lists are in the reviewed catalog (`data/catalog/`); see docs/CATALOG-REVIEW.md. Run `upec-wipe verify` to spot-check whether opt-outs are still in effect.

---

## Explicit brokers

| Broker | Method | CAPTCHA | Confidence | US-only |
|---|---|---|---|---|
| California DROP | manual | n/a | manual | CA only |
| Spokeo | search-form | no | surveyed 2026-10 | yes |
| WhitePages | search-form | no | untested | yes |
| FastPeopleSearch | search-form | yes | submitted 2026-10-14 (CapSolver Turnstile, form accepted; promised email not received yet; the listing check matched a surname-only /name/ page) | yes |
| TruePeopleSearch | direct-form | no | submitted 2026-10-14 (assisted: bot check cleared, form accepted; promised confirmation email not received yet) | yes |
| BeenVerified | manual | - | surveyed 2026-10-11 (you pick your record) | yes |
| PeopleConnect Suppression Center | manual | n/a | manual | yes |
| PeopleFinders | direct-form | yes | submitted 2026-10-14 (assisted; the step 1 form now opens behind a "Next" button, so the name fields were missed - fixed with startSelector the same day; the emailed link expired within the hour, click it at once) | no |
| MyLife | search, then manual | - | surveyed 2026-10-11 (embedded form; you get your listing link) | no |
| FamilyTreeNow | direct-form | yes | failed 2026-10-15 (CapSolver: "We don't support this service" for hCaptcha; hCaptcha is now never sent to CapSolver - run with `--assist` and solve it in the browser window) | no |
| CheckPeople | direct-form | no | untested | no |
| ThatsThem | direct-form | no | submitted 2026-10-14 (assisted; form accepted, the email comes once removal is complete) | no |
| USPhonebook | direct-form | yes | verified 2026-10-14 (run end to end: CapSolver solved the reCAPTCHA, form accepted, emailed link confirmed) | yes |
| SmartBackgroundChecks | direct-form | yes | verified 2026-10-14 (assisted, CapSolver reCAPTCHA, emailed link confirmed) | no |
| SearchPeopleFree | direct-form | yes | verified 2026-10-14 (CapSolver Turnstile; the emailed link, valid 24 hours, opens a second form that asks for street address and date of birth, done by hand) | no |
| PeopleSearchNow | direct-form | yes | surveyed 2026-10 | no |
| InfoTracer | manual | n/a | manual | no |
| SocialCatfish | direct-form | yes | submitted 2026-10-15 (assisted re-run after the state-select fix: CapSolver solved the Turnstile and the form was sent; the site shows no recognised confirmation, so watch the alias inbox) | no |
| NationalPublicData | manual | - | surveyed 2026-10-11 (needs your profile link) | no |
| PrivateRecords | direct-form | no | verified 2026-10-14 (needs your date of birth; emailed link confirmed) | no |
| Acxiom | manual | n/a | manual | no |
| LexisNexis | manual | n/a | manual | no |
| ZoomInfo | manual | n/a | manual | no |
| Clearbit | manual | n/a | manual | no |
| Addresses.com | manual | n/a | manual | no |
| Spokeo (email) | email | n/a | untested | no |
| Epsilon | manual | n/a | manual | no |
| OptOutPrescreen (credit bureaus) | manual | n/a | manual | yes |
| DataAxle | manual | - | surveyed 2026-10-11 (old box was a newsletter signup) | no |
| Pipl | email | n/a | untested | no |
| Google - Results About You | manual | n/a | manual | no |
| Google - Outdated Content | manual | n/a | manual | no |

### Catalog sites run end to end

The catalog sites below were run on 2026-10-14 and their emailed links confirmed. The site said the removal also covers reports members already hold and matching records added later.

| Site | Domain | Result |
|---|---|---|
| We Inform | weinform.org | confirmed 2026-10-14 |
| Truth Now | checksecrets.com | confirmed 2026-10-14 |
| The People Searchers | peoplesearcher.com | confirmed 2026-10-14 |
| Infomatics | privatereports.com | confirmed 2026-10-14 |

They share one request form with PrivateRecords (same operator).

Registry downloads checked 2026-10-12: California works from the CPPA registry (`https://cppa.ca.gov/data_broker_registry/registry.csv`, 866 rows, with a privacy-rights page and contact email per broker). Vermont's export is a script-only web page with no download, so `scripts/update-catalog-sources.js` skips it and says so.

Sites that show a bot-protection page (Cloudflare and similar) are reported as **manual** with their link at run time, whatever this table says. In the 2026-10 survey that was WhitePages, TruePeopleSearch, BeenVerified, PeopleFinders, MyLife, FamilyTreeNow, CheckPeople, ThatsThem, SmartBackgroundChecks and NationalPublicData. Re-check any broker with `node scripts/inspect-broker-forms.js <name>` (read-only, dummy person). With `ASSIST=1` the window is visible and you complete each bot check yourself; the 2026-10-11 assisted survey got past every check except WhitePages, CheckPeople, PeopleSearchNow and ThatsThem.

### Removed in the 2026-10 survey

| Broker | Why |
|---|---|
| Radaris, PeekYou | Domain transferred by court order to Atlas Data Privacy Corp. |
| Nuwber, PublicDataUSA, ClustrMaps | Domain no longer resolves (or points to 127.0.0.1). |
| PeopleSmart | Now a business-leads site with no consumer opt-out. |
| Oracle Data Cloud | Oracle closed its advertising business; the page is a contracts index. |
| AnyWho | Redirects to Spokeo's opt-out, which is already in the list. |
| Intelius, TruthFinder, InstantCheckmate | Merged into "PeopleConnect Suppression Center". |
| Equifax (marketing), Experian (marketing) | Merged into "OptOutPrescreen (credit bureaus)". |
| California DELETE Portal, CalPrivacy DROP | Merged into "California DROP" (California residents only). |

## How confident should I be?

| Path | Confidence | Why |
|---|---|---|
| Explicit + `verified` | High | Hand-tested selectors against the live page. |
| Explicit + `untested` | Medium | Definition exists, DOM may have shifted. Failures show up as `error` or `pending_confirm`. |
| Reviewed catalog | Per record | Reviewed forms, manual links and email requests; re-checked by `upec-wipe catalog-check`. |
| `manual` | High (you) | Opened in your browser; you complete it. |
| `email` | High (delivery) / Medium (compliance) | Email is sent. Whether the broker honors it is up to them. |

After running, use `upec-wipe verify` to search the brokers for your name again and confirm whether listings are gone. `verify` is the honest ceiling: submitted is not deleted.

## Reporting drift

If you notice a `verified` broker has started failing, please open an issue with a screenshot of the broker's current opt-out form. Selector changes are the most common cause.
