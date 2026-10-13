# Privacy and data flow

This page lists every place this fork sends data, what it sends, and which network path it uses. It describes the code on the `upec/hardening` branch. If you change the code, this page may stop being true.

## Short version

- The tool runs on your own machine. There is no central server, no telemetry, no analytics, no crash reporting and no update check. A full code audit found none, in the tool or in its dependencies.
- Brokers get your name and location (they already have them) plus one throwaway SimpleLogin alias instead of your real email.
- A few services get more than brokers do, because their job needs it: SimpleLogin (knows your real inbox), search engines (get your full name and city, only if you run `upec-wipe serp-watch`), your SMTP provider (only if you set up email requests) and CapSolver (gets broker page addresses, only if you give it a key).
- By default nothing leaves your machine unless Mullvad is on. The browser checks before it visits any broker, and the tool checks again before any direct connection (SimpleLogin, CapSolver, SMTP, broker registries). If a check fails, the run stops and nothing is sent.

## What the tool reads

Everything comes from your local `config.json` (or `config.json.enc` if you encrypted it). Nothing about you is looked up online.

| Field | Used for | Sent to |
| --- | --- | --- |
| `person.firstName`, `lastName`, `fullName` | Search URLs and opt-out forms | Brokers. Search engines on `serp-watch`. Your SMTP provider and the email brokers, on `run --email`. |
| `person.city`, `state`, `zip`, `country` | Forms and search URLs | Brokers (zip and country on forms only). City and state go to search engines on `serp-watch` and to the email brokers on `run --email`. |
| `person.email` | Your real address. Never given to brokers when a relay is set. | SimpleLogin (as the inbox the alias forwards to). |
| `person.phone`, `phoneFormatted` | Asked for by setup, but nothing sends it today: no form or email gets your phone. | Nobody. |
| `person.aliases` | Asked for by setup, but nothing uses it today. | Nobody. |
| `person.dob` | Optional (setup). Only forms that require it: PrivateRecords and four reviewed people-search sites in the catalog. Left blank, those go to your manual list. Never written to run logs. | Those sites |
| `relay.apiKey` | Creating your alias | SimpleLogin |
| `capsolver.apiKey` | Solving CAPTCHAs | CapSolver |
| `email.smtp.*` | Sending the email requests | Your SMTP provider. Brokers see the dedicated mailbox address (`user`, also `from`). |

`config.json`, `state.json`, `logs/`, `inbox/` and the files under `data/` that hold your history are git-ignored and kept out of the Docker image.

## Network paths

Every connection uses one of three paths.

- **Browser.** A Playwright Chromium with a fresh profile for each run. Before it opens any broker page it checks the network: with no `network.proxy` it must see a Mullvad exit at `am.i.mullvad.net`; with a proxy it compares the browser's IP with your direct IP (see below). If the check fails, nothing is submitted. The browser is checked again every 10 brokers. WebRTC is limited to the proxy or VPN, and with a proxy all DNS lookups go through the proxy.
- **Direct from Node.** SimpleLogin, CapSolver, SMTP, the broker registries and the `doctor` probes do not use the browser. Before the first of these in each run, the tool checks `am.i.mullvad.net` from Node, checks again once 5 minutes have passed since the last check and before every email, and stops if you are not on Mullvad (message: `Network check failed for direct connections - nothing was sent.`). With `network.proxy` set, these connections cannot use the proxy. The tool says so once per run and they go out from your real IP, unless your VPN is system-wide.
- **Your everyday browser.** At the end of a run, pages that need you (manual opt-outs, failed CAPTCHAs) open in your normal browser, with your own cookies and no proxy. Only a system-wide VPN covers them.

`network.required: false` turns both checks off. Do not do that unless you know why.

## Where data goes

| Destination | What is sent | When | Path |
| --- | --- | --- | --- |
| Explicit brokers (32 in `brokers.js`, such as Spokeo, Whitepages, MyLife) and reviewed catalog sites | Search URLs with your name and state. Forms with your name, city, state, zip and your alias in every email field. | `upec-wipe run` | Browser |
| Same brokers | The same search URLs with your name. Forms are filled but not submitted. The alias is your cached one, or the placeholder `preview-alias@relay.invalid`. CapSolver is not called and nothing opens in your everyday browser. | `upec-wipe preview` | Browser |
| Search-form brokers | Each person's own search URLs, to see if you are still listed. Results are saved to `state.json`. | `upec-wipe verify` | Browser |
| Sites from the public broker lists outside the catalog | Nothing. The generic pass that filled their forms was retired; a leftover `--generic` or `generic.enabled: true` stops the run. | Never | - |
| DuckDuckGo, Bing, Google | `"<full name>" "<city>, <state>"` for every person | `upec-wipe serp-watch` | Browser |
| `am.i.mullvad.net` | Nothing but your IP | Every browser session that visits sites (again every 10 brokers), and before direct connections (again after 5 minutes and before every email) | Browser and direct |
| `api.ipify.org` | Nothing but your IP: once through the proxy, once direct (this one shows your real IP) | Only when `network.proxy` is set | Browser and direct |
| SimpleLogin (`app.simplelogin.io`) | Your API key and a neutral note. SimpleLogin already knows your real inbox, because the alias forwards there. | A real run, when no alias is cached yet for that person. `upec-wipe doctor` also sends the key once to check it (account info request; no alias is made, and the reply is discarded). | Direct |
| CapSolver (`api.capsolver.com`) | Your API key, the address of the broker page showing the CAPTCHA and the CAPTCHA's site key, a public code the page uses to identify its CAPTCHA (for AWS WAF also its key, iv and context). No images, and none of your config fields. | A broker shows a CAPTCHA and you set a real key | Direct |
| Your SMTP server, then the broker | A fixed subject (opt out of sale and targeted advertising, and delete). Body with your name, city and state, asking the broker to reply to the dedicated mailbox. The broker sees that mailbox's address. TLS 1.2 or newer is required. | `upec-wipe run --email`, after you type `SEND`; only with the `email` block | Direct |
| `oag.ca.gov`, `bizfilings.vermont.gov` | Nothing about you | `node scripts/update-catalog-sources.js` (maintainers; it replaced the removed `upec-wipe update-brokers`) | Direct |
| Your SMTP host (connection only) and `api.capsolver.com` (one HEAD request) | Nothing about you | `upec-wipe doctor` | Direct |
| Manual-action pages | The page address only | End of a real run, when some brokers need you | Everyday browser |
| Install downloads (npm, the Playwright browser, NodeSource, Ubuntu packages, the fork's git host) | Nothing about you, but your real IP if Mullvad is not on yet | `install.sh` and the install steps in the manual | Direct |
| Nothing | `upec-wipe pending`, `upec-wipe list` and `upec-wipe reply` make no outside connections. | | |

## What stays on your machine

To delete it all, run `upec-wipe clear-all`; `upec-wipe clear` deletes only the config and passphrase.

- `config.json` (or `config.json.enc`): all your details. Encryption covers this file only.
- `state.json`: which brokers you submitted to and when, and your alias mapping keyed by your real email. Plaintext.
- `logs/`: plaintext, and it holds personal data. Each real run writes `logs/audit-*.md`, which starts with your full name and **real email**. Older versions also wrote complaint letters under `logs/complaints/` and form screenshots under `logs/snapshots/`; those commands were removed, and `upec-wipe doctor` points out any that are left. Error details in `logs/run-*.json` keep only the site's address, and previews that show filled-in fields are printed to the screen, not written there. Never share `logs/` files for help; copy only the lines you need and remove your details.
- `data/serp-history.json`: search-scan history (an older `data/exposure-history.json` is left from the removed score command; `doctor` points it out). `data/.serp-key` is a random key used to label the search history without writing your name.

New files are created readable only by you (umask 077, mode 600).

## Who learns what

- **Brokers** learn your name and location (which they have already) and the alias. They also see a Mullvad IP (or your proxy's IP if you set `network.proxy`). Because all brokers get the same alias, they could match their records on it.
- **SimpleLogin** knows your real inbox and every alias. It sees which brokers email you.
- **CapSolver** knows your account and the addresses of broker opt-out pages that showed a CAPTCHA ([STATUS.md](../STATUS.md) marks which brokers usually do). Those addresses have no name in them. Without a key, a broker whose page shows a CAPTCHA is recorded as failed (`captcha_failed`) and its page opens in your browser at the end of the run; `--retry-failed` tries it again later. `--no-capsolver` records those brokers as manual instead.
- **Search engines** get your full name with your city and state when you run `upec-wipe serp-watch`.
- **Your SMTP provider** sees every email request, if you set them up.
- **Mullvad** sees the traffic leaving its servers, as any VPN does.

## How to check it yourself

```
git check-ignore config.json state.json logs/run.json data/.serp-key
```

All four names are printed, so a normal `git add` skips them. (`git add -f` would still add them; never do that.)

```
node bin/upec-wipe.js preview
```

Shows what each broker form would get, without submitting. This does use the network: it runs the Mullvad check and opens each broker's search page with your name.

```
node bin/upec-wipe.js doctor
```

Checks your setup. Its network probes (SMTP host, CapSolver) run only after the direct-connection check passes, so off Mullvad they show as skipped. With `network.proxy` set or `network.required: false` they run straight from your real IP.

For the threats this does and does not cover, read [THREAT-MODEL.md](THREAT-MODEL.md).
