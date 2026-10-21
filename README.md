# UPEC-WIPE

**Web Identity Purge Engine** - a privacy-first tool that asks data brokers and people-search sites to stop selling your personal information and delete it, through their web forms and by email.

![CI](https://github.com/Asher-Coleman-GIT/upec-wipe/actions/workflows/test.yml/badge.svg)

UPEC-WIPE sends requests; it cannot erase anything itself. Each broker decides how fully it complies, and some refuse. What the tool does is make every request you are entitled to send, while giving brokers nothing they did not already have except one throwaway email alias.

It is built for members of [UPEC](https://utahupec.org) in Utah. The web-form opt-outs work wherever you live in the US, but the email requests rest on the Utah Consumer Privacy Act: almost all of them go only to Utah residents.

> Fork of [auto-identity-remove](https://github.com/stephenlthorn/auto-identity-remove) by Stephen Thorn (MIT). UPEC-WIPE keeps its form-filling engine and adds a fail-closed privacy model, a reviewed site catalog and email requests. **New here? Start with the [manual](docs/UPEC-MANUAL.md).**

## Privacy guarantees

- **Your real email is never sent to a broker.** Every form gets one SimpleLogin alias. If no alias can be made, nothing is submitted for you; there is no fallback to the real address.
- **Nothing leaves your machine off the VPN.** The browser and every direct connection (SimpleLogin, CapSolver, SMTP, IMAP, the broker registries) pass a Mullvad check first. If it fails, the command stops before connecting.
- **Nothing runs on its own.** No scheduler, no background job, no telemetry or update check. It runs when you start it.
- **Local only.** It never runs as root, its files are readable only by you, `config.json` can be encrypted at rest, and there is no local server. Page text saved in run logs has your details replaced by `[redacted]`.
- **Email requests need you.** A plain run never sends email. `run --email` needs a terminal and you typing `SEND`; it sends from a mailbox used only for this, one email every 45 seconds, at most 100 per run, and never to the same broker address twice.

What each layer does and does not protect: [THREAT-MODEL.md](docs/THREAT-MODEL.md). Every destination and exactly what it gets: [PRIVACY.md](docs/PRIVACY.md).

## How a month works

1. **Connect Mullvad**, then run `upec-wipe run --assist` and stay at the computer. It searches each broker for you, fills and submits the opt-out forms, and when a site shows a bot check it waits for you to clear it in the browser window. A plain `upec-wipe run` works unattended but leaves those sites for you to finish by hand.
2. **Click the confirmation emails** that arrive at your alias, and **finish the sites left to you**. `upec-wipe pending` lists the brokers waiting for a click; `upec-wipe manual` lists the sites to do by hand, each with its link. Mark each one finished with `upec-wipe done "<name>"`.
3. **Send the email requests** (once you have set up the dedicated mailbox): `upec-wipe preview --email` shows every email and the policy sentence that gives you the right; `upec-wipe run --email` sends them. Each broker gets an opt-out of sale and targeted ads plus a deletion request.
4. **Read the replies**: `upec-wipe read-email` reads the dedicated mailbox (read-only), sorts each broker's reply (honored, refused, wants verification, bounced) and logs the outcomes you confirm. `upec-wipe reply <broker> honored|refused|verify|none|bounced` logs one by hand.
5. **Check you are gone**, every few months. `verify --assist` re-checks the 6 brokers whose search it can read (Spokeo, USPhonebook, TruePeopleSearch, SmartBackgroundChecks, WhitePages and FastPeopleSearch); `web-check --assist` searches DuckDuckGo and Google for your name and city and lists the known broker sites that show it. Brokers add people back, so repeat the run monthly.

## Quick start

Needs Node.js 20+ on Linux, macOS or Windows (WSL2), the [Mullvad](https://mullvad.net) app and a [SimpleLogin](https://simplelogin.io) API key. A CapSolver key and a dedicated email account for the email requests are optional. The [manual](docs/UPEC-MANUAL.md) walks through each step, including Docker.

```bash
git clone https://github.com/Asher-Coleman-GIT/upec-wipe.git
cd upec-wipe
bash install.sh                      # checks Node, installs deps and Chromium
node bin/upec-wipe.js setup          # writes config.json (gitignored)
node bin/upec-wipe.js doctor         # checks the setup, including the VPN
node bin/upec-wipe.js preview        # fills forms with a dummy person, submits nothing
node bin/upec-wipe.js run --assist   # the real opt-out pass
```

Run `npm link` once to type `upec-wipe` instead of `node bin/upec-wipe.js`.

## Commands

| Command | What it does |
| --- | --- |
| `setup` | Interactive first-run setup (creates `config.json`) |
| `doctor` | Checks your environment, configuration and VPN |
| `preview` | Rehearsal: fills forms with a dummy person, submits nothing (`--email`: shows your emails, sends nothing) |
| `run` | The opt-out pass: web forms by default (`--forms`); `--email` sends the email requests |
| `pending` | Lists brokers awaiting an email-confirmation click |
| `manual` | Lists the sites waiting for you to finish by hand, with their links |
| `done` | Marks a site finished by hand, or its confirmation link clicked |
| `read-email` | Reads the replies to your email requests (read-only) and logs each outcome you confirm |
| `reply` | Logs a broker's reply to an email request by hand |
| `verify` | Re-searches the 6 brokers whose search it can read and reports whether you still appear |
| `list` | Lists brokers, the catalog sites you can act on and the email requests, each with its status |
| `web-check` | Searches DuckDuckGo and Google for your name and lists the known broker sites that show it |
| `clear` | Deletes your setup (config and passphrase); keeps history |
| `clear-all` | Deletes everything UPEC-WIPE saved on this computer |

Retired commands and why: [docs/REFERENCE.md](docs/REFERENCE.md#retired-commands).

Useful options: `--assist` (clear a bot check yourself and the run carries on), `--only "<broker>,<broker>"`, `--skip "<broker>"`, `--resume`, `--retry-failed`, `--no-capsolver`. Names must match the ones `list` shows, and a mistyped flag or a stray word stops the command instead of starting a full run. `upec-wipe --help` lists everything, and the [manual's command reference](docs/UPEC-MANUAL.md#command-reference) says what each command sends.

## What it covers, and how far to trust it

| Source | Count | What it is |
| --- | --- | --- |
| **Explicit brokers** (`brokers.js`) | 31 | Spokeo, WhitePages, PeopleConnect, BeenVerified and others with hand-mapped forms: 14 the tool submits, 16 it hands to you with the link (sites that need an account, an ID or a step the tool cannot do), plus Pipl by email. [STATUS.md](STATUS.md) has the per-broker table. |
| **Reviewed catalog** (`data/catalog/`) | 642 | Every site from the public broker lists (The Markup, BADBOOL, the California registry), surveyed and reviewed: 46 you can act on (4 forms the tool fills, 42 links to finish by hand), 45 email requests, 448 excluded (not about individuals, or covered by another site), 103 still to review (mostly sites that did not load through the VPN). |
| **Email requests** (`run --email`) | 46 | 45 catalog business brokers whose policy gives a Utah right (44) or honors every US resident (1), plus Pipl. Brokers that answered "use our form" or whose address bounced are manual links now. Each gets an opt-out of sale and targeted ads plus a deletion request under the Utah Consumer Privacy Act, sent from your dedicated mailbox. |

Four are marked `verified` (run end to end on 2026-10-14): USPhonebook, SmartBackgroundChecks, SearchPeopleFree and PrivateRecords. For the rest, a read-only survey re-read the live forms, but they have not been tested end to end. `Submitted` means a broker accepted the form, not that you are deleted. Broker sites change their pages constantly; a form the tool cannot fill, or whose submit button it cannot find, is never submitted and goes to your `manual` list instead. Details in [docs/REFERENCE.md](docs/REFERENCE.md#brokers-covered).

## Project layout

```
upec-wipe/
├── bin/upec-wipe.js      the upec-wipe command; maps subcommands to watcher.js flags
├── watcher.js            entry point; checks the flags, picks a mode and runs it
├── lib/modes/            one file per mode (run, read-email, reply, list, manual, doctor, clear, ...)
├── lib/                  shared engine: browser, forms, egress check, relay, email step,
│                         mail reader, catalog, state, redaction, CAPTCHA
├── brokers.js            the 31 explicit brokers
├── data/catalog/         one reviewed record per site (tokens only, never real values)
├── setup.js              interactive setup
├── scripts/              catalog survey and review tools, registry refresh, upstream
│                         and cross-model review, hardening
├── test/                 node:test suite (npm test)
└── docs/                 manual, privacy, threat model, reference, design specs
```

`config.json`, `state.json` and `logs/` hold your personal data. They are gitignored and stay on your machine.

## Documentation

| Read | For |
| --- | --- |
| [docs/UPEC-MANUAL.md](docs/UPEC-MANUAL.md) | Setting up and running it, step by step |
| [docs/PRIVACY.md](docs/PRIVACY.md) | Every place data goes, and what it gets |
| [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) | What each safeguard protects, and what it does not |
| [docs/REFERENCE.md](docs/REFERENCE.md) | Run results, verify, brokers covered, Docker, environment variables, maintenance, international users |
| [STATUS.md](STATUS.md) | Per-broker method and confidence |
| [docs/CATALOG-REVIEW.md](docs/CATALOG-REVIEW.md) | How catalog sites are surveyed and reviewed |
| [docs/relay.md](docs/relay.md) | The masked-email relay |
| [docs/SYNOLOGY.md](docs/SYNOLOGY.md) | Running on a Synology NAS |
| [FORK.md](FORK.md) | Pulling upstream changes, what is still to verify |
| [docs/superpowers/specs/](docs/superpowers/specs/) | Design documents for each change |

## Development

```bash
npm test                             # about 80 s
```

Write the failing test first. Tests use the dummy person from `config.example.json`; never put real personal data in any tracked file, test or commit message. Tracked files use plain hyphens only. Rules for AI agents working here are in [CLAUDE.md](CLAUDE.md).

## Security and review

`config.json` holds your legal name, address, email, date of birth and API keys. If you find a way for any of it to escape - into a log, a report, the wrong form field, another local user, or a site chosen by a remote registry - report it privately; see [SECURITY.md](SECURITY.md).

Most of this code was written by AI models. Files that touch personal data, crypto, subprocesses or untrusted network input need a review from a different model family before merge; CI runs the test suite, builds the Docker image and launches Chromium inside it. The policy and what it does and does not buy you: [docs/CROSS_MODEL_REVIEW.md](docs/CROSS_MODEL_REVIEW.md) (`npm run review:cross-model`).

## License

MIT - see [LICENSE](LICENSE). UPEC-WIPE is a fork of [auto-identity-remove](https://github.com/stephenlthorn/auto-identity-remove), copyright (c) 2026 Stephen Thorn; the fork's changes are copyright (c) 2026 the UPEC-WIPE contributors. Both notices are kept in LICENSE, as the MIT license requires.
