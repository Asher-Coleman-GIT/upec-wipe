# UPEC Hardened Fork - Design

Date: 2026-10-07
Upstream: https://github.com/stephenlthorn/auto-identity-remove @ `99fb638`
Audience: the fork owner first, then members of the UPEC privacy engineering club.

## Goal

A personal fork of auto-identity-remove whose defaults are safe for someone who does
not read the code. "Safe" here means: the only email address a broker can learn is a
disposable SimpleLogin alias, the tool never runs as root, secrets never sit in plain
text in a unit file, the dashboard is unreachable from the network, and upstream
changes are pulled only after a human has read the diff.

## Review findings this design responds to

| # | Finding | Where |
|---|---------|-------|
| F0 | **SimpleLogin integration cannot work:** it POSTs `{note}` to `/api/alias/custom/new` (undocumented; the documented custom endpoint is `/api/v3/alias/custom/new` and requires `alias_prefix`, `signed_suffix`, `mailbox_ids`) and reads `data.alias`, but SimpleLogin returns the address in `email`. Combined with F1, every run silently used the real email. Fix: `POST /api/alias/random/new?mode=word` with optional `{note}`, read `email`. Source: github.com/simple-login/app `docs/api.md` | `lib/relay.js` `createSimpleLoginAlias` |
| F1 | Relay alias failure silently falls back to the real email | `lib/relay.js` `getSubmissionEmail` catch block |
| F2 | Generic pass (~490 sites) ignores the alias and submits `person.email` | `generic-runner.js` `getFieldMap`; `watcher.js` generic loop |
| F3 | Email opt-outs advertise the alias but send `From:` the real SMTP account | `lib/email.js` `_sendViaSMTP` |
| F4 | Right-to-know requests never use the relay at all | `lib/right-to-know-runner.js`, `lib/right-to-know.js` |
| F5 | Dashboard honours any `AIDR_HOST` and starts unauthenticated when run directly | `dashboard/server.js` |
| F6 | Dashboard Schedule tab writes `/etc/systemd/system`, i.e. requires root; examples run as root with `AIDR_PASS=change-me` | `dashboard/server.js`, `dashboard/examples/*` |
| F7 | Passphrase can only come from the environment | `lib/config.js` `getPassphrase`, `setup.js`, `dashboard/server.js` |
| F8 | `run.sh` exits when only `config.json.enc` exists, so an encrypted setup cannot use the scheduler | `run.sh` |
| F9 | Generated systemd unit has no `UMask` / hardening / credential support | `lib/scheduler.js` `buildSystemdUnits` |
| F10 | `npm audit`: 3 high (axios/form-data, nodemailer) root, 1 critical + 3 moderate (express/qs/proxy-addr) dashboard | lockfiles |
| F11 | Repo on a Windows drive under WSL (`/mnt/c`) silently ignores `chmod`, so every PII file is world-readable | environment |
| F12 | Nothing stops `node watcher.js` running as root | `watcher.js` |

## Decisions (confirmed with the owner)

1. **Generic pass:** off by default. Enabled only by `--generic` or `config.generic.enabled === true`. When enabled it uses the relay alias.
2. **Relay:** strict fail-closed.
   - Relay configured, alias unobtainable -> that person gets **no** submissions this run (forms, email, generic, right-to-know).
   - `config.relay.required === true` and no usable relay config -> run refuses to start.
   - Email-channel submissions (opt-out emails, right-to-know) while an alias is in use are sent only when `email.smtp.from` is explicitly set and does not contain the person's real email; otherwise they are logged `manual` with the reason.
   - No relay configured and not required -> upstream behaviour (real email), with a one-line warning.
3. **Passphrase sources**, in priority order: explicit override, `AIDR_PASSPHRASE`, `AIDR_PASSPHRASE_FILE`, `$CREDENTIALS_DIRECTORY/aidr-passphrase` (systemd `LoadCredential=`). A passphrase file readable by group/other is refused. No macOS Keychain.
4. **Dashboard:** refuses to start on a non-loopback host or without credentials. Schedule POST is disabled (returns 501). Root example units are deleted.
5. **Root:** `watcher.js` and `dashboard/server.js` refuse to run as uid 0.
6. **Fork workflow:** local branch only for now. `origin` is renamed to `upstream`; the base commit `99fb638` is recorded in `UPSTREAM_BASE`; `scripts/upstream-review.sh` shows the log + diff since the base and never merges.
7. **Dependencies:** `npm audit fix` in both manifests, nodemailer bumped to 10.x, direct deps pinned to exact versions, CI runs `npm audit --audit-level=high`.
8. **Docker:** keep non-root `pwuser`; compose gains `cap_drop: [ALL]`, `no-new-privileges`, and a `secrets:` passphrase file wired to `AIDR_PASSPHRASE_FILE`.
9. **Permissions:** `run.sh` sets `umask 077`; `scripts/harden.sh` chmods the repo 700 / PII files 600 and fails loudly when chmod is ineffective (DrvFs) or when run as root.

### Added in round 2 (confirmed with the owner)

10. **Egress, fail-closed.** Brokers and search engines must never see the member's home IP. Before any browser work that touches the network, the browser itself loads a check page:
    - default (no proxy): `https://am.i.mullvad.net/json` must return `mullvad_exit_ip: true` (works with the Mullvad app or Mullvad's SOCKS5 proxy);
    - `network.proxy` set (any VPN/proxy, e.g. `socks5://10.64.0.1:1080`): Chromium is launched with that proxy, and the browser's IP from `https://api.ipify.org?format=json` must differ from the direct IP.
    - Check fails or errors -> the run exits non-zero before visiting any broker. `network.required: false` disables the check (with a warning). With a proxy, WebRTC is forced through the proxy (`--force-webrtc-ip-handling-policy=disable_non_proxied_udp`).
    - Known limit: non-browser HTTP (CapSolver, HIBP, SimpleLogin, SMTP) is not proxied; with a system-wide VPN it is covered anyway. Documented in the threat model.
11. **Ephemeral browser profile.** Each browser launch uses a fresh `mkdtemp` profile (mode 700) deleted on close. `browser.persistentProfile: true` restores upstream behaviour. No broker in `lib/broker-runner.js` relies on a saved login.
12. **No notifications.** Remove iMessage, desktop toasts, webhooks, `dispatchNotify`, serp-watch alerts and the emailed monthly report. Results go only to the terminal and local `logs/`. `openInBrowser` (opening manual-action sites locally) stays. A config that still has `notify` gets a one-line "ignored" warning.
13. **Docs for the club.** `docs/THREAT-MODEL.md` (what each layer buys, what it does not, one instance per member) and `docs/UPEC-MANUAL.md` (beginner guide: Windows via WSL2, Linux, Docker).

## Non-goals

- Pushing to GitHub or opening PRs upstream (owner will push later).
- macOS Keychain integration.
- Changing broker selectors or the generic runner's heuristics.
- Verifying Docker changes on a Docker host from this machine (no Docker here); flagged for manual verification.
