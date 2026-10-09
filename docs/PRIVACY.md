# Privacy and data flow

This page lists every place this fork sends data, what it sends, and which network path it uses. It describes the code on the `upec/hardening` branch. If you change the code, this page may stop being true.

## Short version

- The tool runs on your own machine. There is no central server, no telemetry, no analytics, no crash reporting and no update check. A full code audit found none, in the tool or in its dependencies.
- Brokers get your name and location (they already have them) plus one throwaway SimpleLogin alias instead of your real email.
- A few services get more than brokers do, because their job needs it: SimpleLogin (knows your real inbox), Have I Been Pwned (gets your real email, only if you run `aidr breach`), search engines (get your full name and city, only if you run `aidr serp` or `aidr serp-watch`), your SMTP provider (only if you keep the `email` block) and CapSolver (gets broker page addresses, only if you give it a key).
- By default nothing leaves your machine unless Mullvad is on. The browser checks before it visits any broker, and the tool checks again before any direct connection (SimpleLogin, CapSolver, HIBP, SMTP, broker registries). If a check fails, the run stops and nothing is sent.

## What the tool reads

Everything comes from your local `config.json` (or `config.json.enc` if you encrypted it). Nothing about you is looked up online.

| Field | Used for | Sent to |
| --- | --- | --- |
| `person.firstName`, `lastName`, `fullName`, `aliases` | Search URLs and opt-out forms | Brokers. Search engines on `serp`. SMTP provider and email brokers if you keep the `email` block. |
| `person.city`, `state`, `zip`, `country` | Forms and search URLs | Brokers. City and state go to search engines on `serp`. |
| `person.email` | Your real address. Never given to brokers when a relay is set. | SimpleLogin (as the inbox the alias forwards to). HIBP on `aidr breach`. |
| `person.phone`, `phoneFormatted` | Forms that ask for a phone number, and email opt-outs | Brokers that ask for it. SMTP provider if you keep the `email` block. |
| `relay.apiKey` | Creating your alias | SimpleLogin |
| `capsolver.apiKey` | Solving CAPTCHAs | CapSolver |
| `hibp.apiKey` | Breach check | HIBP |
| `email.smtp.*` | Sending email opt-outs | Your SMTP provider. Brokers can see the SMTP account address (`user`). |

`config.json`, `state.json`, `logs/`, `inbox/` and the files under `data/` that hold your history are git-ignored and kept out of the Docker image.

## Network paths

Every connection uses one of three paths.

- **Browser.** A Playwright Chromium with a fresh profile for each run. Before it opens any broker page it checks the network: with no `network.proxy` it must see a Mullvad exit at `am.i.mullvad.net`; with a proxy it compares the browser's IP with your direct IP (see below). If the check fails, nothing is submitted. WebRTC is limited to the proxy or VPN, and with a proxy all DNS lookups go through the proxy.
- **Direct from Node.** SimpleLogin, CapSolver, HIBP, SMTP, the broker registries and the `doctor` probes do not use the browser. Before the first of these in each run, the tool checks `am.i.mullvad.net` from Node and stops if you are not on Mullvad (message: `Network check failed for direct connections - nothing was sent.`). With `network.proxy` set, these connections cannot use the proxy. The tool says so once per run and they go out from your real IP, unless your VPN is system-wide.
- **Your everyday browser.** At the end of a run, pages that need you (manual opt-outs, failed CAPTCHAs) open in your normal browser, with your own cookies and no proxy. Only a system-wide VPN covers them.

`network.required: false` turns both checks off. Do not do that unless you know why.

## Where data goes

| Destination | What is sent | When | Path |
| --- | --- | --- | --- |
| Explicit brokers (44 in `brokers.js`, such as Spokeo, Whitepages, Radaris, MyLife) | Search URLs with your name and state. Forms with your name, city, state, zip, phone where asked, and your alias in every email field. | `aidr run` | Browser |
| Same brokers | The same search URLs with your name. Forms are filled but not submitted. The alias is your cached one, or the placeholder `preview-alias@relay.invalid`. | `aidr preview` | Browser |
| Search-form brokers | Each person's own search URLs, to see if you are still listed. Results are saved to `state.json`. | `aidr verify` | Browser |
| About 490 other sites from public datasets and the CA and Vermont registries | Name, alias, state and zip on whatever form the site has. A "Do Not Sell" link can lead to any page. | Only with `--generic` or `generic.enabled: true` | Browser |
| DuckDuckGo, Bing, Google | `"<full name>" "<city>, <state>"` for every person | `aidr serp`, `aidr serp-watch`, dashboard "serp" | Browser |
| `am.i.mullvad.net` | Nothing but your IP | Every browser session that visits sites, and once per run before any direct connection | Browser and direct |
| `api.ipify.org` | Nothing but your IP: once through the proxy, once direct (this one shows your real IP) | Only when `network.proxy` is set | Browser and direct |
| SimpleLogin (`app.simplelogin.io`) | Your API key and a neutral note. SimpleLogin already knows your real inbox, because the alias forwards there. | A real run or `aidr know`, when no alias is cached yet for that person | Direct |
| CapSolver (`api.capsolver.com`) | Your API key, the address of the broker page showing the CAPTCHA and the CAPTCHA's site key (for AWS WAF also its key, iv and context). No images, and none of your config fields. | A broker shows a CAPTCHA and you set a real key | Direct |
| Your SMTP server, then the broker | Subject with your full name. Body with your name, city, state, zip, phone and alias. The broker can also see the SMTP account address. TLS 1.2 or newer is required. | A real run, only if you keep the `email` block. The recommended setup deletes it. | Direct |
| Your SMTP server, then the broker | A CCPA or GDPR right-to-know request with the same fields | `aidr know` with the `email` block. Without it, the request text is printed for you to send by hand. | Direct |
| Have I Been Pwned | **Your real email**, for every person, plus your HIBP key. The user agent is a generic `Mozilla/5.0`. | `aidr breach`, only with `hibp.apiKey` set | Direct |
| `oag.ca.gov`, `bizfilings.vermont.gov` | Nothing about you | `aidr update-brokers` | Direct |
| Your SMTP host (connection only) and `api.capsolver.com` (one HEAD request) | Nothing about you | `aidr doctor` | Direct |
| Broker confirmation links from your saved `.eml` files | The confirmation token in the link. The link must be on the broker's own domain. | `--confirm-emails` or dashboard "confirm" | Browser |
| Manual-action pages | The page address only | End of a real run, when some brokers need you | Everyday browser |
| Install downloads (npm, the Playwright browser, NodeSource, Ubuntu packages, the fork's git host) | Nothing about you, but your real IP if Mullvad is not on yet | `install.sh` and the install steps in the manual | Direct |
| Nothing | `aidr report`, `aidr complaints`, `aidr score`, `aidr pending`, `aidr list` and `aidr freeze` make no outside connections. The dashboard itself makes none either; runs you start from it behave like the commands above. | | |

## What stays on your machine

- `config.json` (or `config.json.enc`): all your details. Encryption covers this file only.
- `state.json`: which brokers you submitted to and when, and your alias mapping keyed by your real email. Plaintext.
- `logs/`: run results. Error details keep only the site's address, not the page path. Previews that show filled-in fields are printed to the screen and not written to `logs/run-*.json`. On the monthly systemd job, everything printed goes to `logs/systemd.log`. That includes the right-to-know text that `aidr know` prints when there is no `email` block.
- `data/serp-history.json` and `data/exposure-history.json`: search-scan and exposure-score history. `data/.serp-key` is a random key used to label the search history without writing your name.

New files are created readable only by you (umask 077, mode 600).

## Who learns what

- **Brokers** learn your name and location (which they have already) and the alias. They also see a Mullvad IP. Because all brokers get the same alias, they could match their records on it.
- **SimpleLogin** knows your real inbox and every alias. It sees which brokers email you.
- **CapSolver** knows your account and the addresses of broker opt-out pages that showed a CAPTCHA. Today those are BeenVerified, MyLife and FamilyTreeNow, and their opt-out addresses have no name in them. Without a key, those brokers are listed as manual. `--no-capsolver` does the same.
- **HIBP** gets your real email when you run `aidr breach`.
- **Search engines** get your full name with your city and state when you run `aidr serp`.
- **Your SMTP provider** sees every opt-out email, if you keep the `email` block.
- **Mullvad** sees the traffic leaving its servers, as any VPN does.

## How to check it yourself

```
git check-ignore config.json state.json logs/run.json data/.serp-key
```

All four names are printed, so none of them can be committed.

```
node bin/aidr.js preview
```

Shows what each broker form would get, without submitting. This does use the network: it runs the Mullvad check and opens each broker's search page with your name.

```
node bin/aidr.js doctor
```

Checks your setup. Its network probes (SMTP host, CapSolver) run only on Mullvad; off Mullvad they show as skipped.

For the threats this does and does not cover, read [THREAT-MODEL.md](THREAT-MODEL.md).
