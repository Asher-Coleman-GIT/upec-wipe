# Broker Status

> **Reality check:** Every broker entry here is labeled `untested` until manually verified against the live site. The selectors compile and the test suite verifies their internal structure, but no end-to-end verification has been performed in the current run window. Many of these sites change their DOM frequently - selectors decay.
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

**Last updated:** auto-generated table - re-run `node scripts/generate-status.js` after editing `brokers.js`.

## How to read this

- **Method** - how the opt-out is automated. `search-form` (looks you up first, then submits removal), `direct-form` (goes straight to the opt-out URL), `email` (sends a removal-request email), `manual` (opened in your browser).
- **CAPTCHA** - whether CapSolver is invoked before submit.
- **Confidence** - `surveyed 2026-10` means the selectors were read from the live opt-out page on 2026-10-10 (no submit). `verified` means the selectors / flow have been manually confirmed against the live site. `untested` means the entry exists but has not been hand-verified end-to-end and depends on the broker not having changed its DOM.
- **US-only** - site indexes US public records / voter data / phone directories; automatically skipped for non-US users.

**This list covers the 32 explicit brokers in `brokers.js` only.** The other ~490 brokers in `data/markup-parsed.json` and `data/badbool-extra.json` are handled by the heuristic generic runner - every one of those is best-effort. Run `node watcher.js --verify` to spot-check whether opt-outs are still in effect.

---

## Explicit brokers

| Broker | Method | CAPTCHA | Confidence | US-only |
|---|---|---|---|---|
| California DROP | manual | n/a | manual | CA only |
| Spokeo | search-form | no | surveyed 2026-10 | yes |
| WhitePages | search-form | no | untested | yes |
| FastPeopleSearch | search-form | yes | surveyed 2026-10 | yes |
| TruePeopleSearch | direct-form | no | surveyed 2026-10-11 (assisted) | yes |
| BeenVerified | manual | - | surveyed 2026-10-11 (you pick your record) | yes |
| PeopleConnect Suppression Center | manual | n/a | manual | yes |
| PeopleFinders | direct-form | yes | surveyed 2026-10-11 (step 1 of 2; step 2 is the emailed link) | no |
| MyLife | search, then manual | - | surveyed 2026-10-11 (embedded form; you get your listing link) | no |
| FamilyTreeNow | direct-form | yes | surveyed 2026-10-11 (assisted) | no |
| CheckPeople | direct-form | no | untested | no |
| ThatsThem | direct-form | no | untested | no |
| USPhonebook | direct-form | yes | surveyed 2026-10 | yes |
| SmartBackgroundChecks | direct-form | yes | surveyed 2026-10-11 (assisted) | no |
| SearchPeopleFree | direct-form | yes | surveyed 2026-10 | no |
| PeopleSearchNow | direct-form | yes | surveyed 2026-10 | no |
| InfoTracer | manual | n/a | manual | no |
| SocialCatfish | direct-form | yes | surveyed 2026-10 | no |
| NationalPublicData | manual | - | surveyed 2026-10-11 (needs your profile link) | no |
| PrivateRecords | direct-form | no | surveyed 2026-10-11 (needs your date of birth; manual without it) | no |
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
| Generic runner (~490 sites) | Best-effort | 4-strategy heuristic. Many succeed; some get a manual fallback. **Not guaranteed.** |
| `manual` | High (you) | Opened in your browser; you complete it. |
| `email` | High (delivery) / Medium (compliance) | Email is sent. Whether the broker honors it is up to them. |

After running, use `node watcher.js --verify` to search the broker for your name again and confirm whether listings are gone. `--verify` is the honest ceiling - "submitted" ≠ "deleted."

## Reporting drift

If you notice a `verified` broker has started failing, please open an issue with a screenshot of the broker's current opt-out form. Selector changes are the most common cause.
