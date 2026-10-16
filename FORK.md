# UPEC hardened fork

Fork of https://github.com/stephenlthorn/auto-identity-remove pinned at the commit in
`UPSTREAM_BASE`. `docs/superpowers/specs/` holds the design for each change, starting
with `2026-10-07-upec-hardened-fork-design.md`. Since then the fork added the
reviewed site catalog and the email requests, and retired the generic pass, the
dashboard and several side commands (see the "Retired commands" table in
`docs/REFERENCE.md`).

Runs are manual only. Setup installs no scheduled job, and there is no
`--install-scheduler`.

## Pulling upstream changes

    bash scripts/upstream-review.sh | less

Read the whole diff. Upstream is largely AI-written and changes quickly. Only then
merge by hand and write the reviewed commit SHA into `UPSTREAM_BASE`. Do not merge
upstream code back into a retired feature (the dashboard, the generic runner, the
removed commands): the fork refuses those on purpose.

## Setting it up

Follow [docs/UPEC-MANUAL.md](docs/UPEC-MANUAL.md). Read
[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) to know what it does and does not protect.

## Docker verification

Status: CI (`.github/workflows/test.yml`, job `docker`) builds the image and runs
`scripts/ci/docker-smoke.js` in it on every push, which launches Chromium and fills a
form. That run uses plain `docker run`, so the compose hardening (`user: pwuser`,
`cap_drop: [ALL]`, `no-new-privileges`, passphrase secret) is still not run anywhere.

Commands to run on a Docker host:

    docker compose build && docker compose run --rm watcher node watcher.js --doctor
    docker compose run --rm watcher node watcher.js --preview --only Spokeo

Still to confirm: that Chromium launches under `cap_drop: [ALL]`. Its own sandbox
needs user namespaces, which dropping all capabilities can block. If launch fails,
check what `buildLaunchOptions` passes in Docker (`grep -n "sandbox" lib/browser.js`).
Do not add `SYS_ADMIN` back. Record the outcome here once checked.

## Still to verify

- The compose steps above (`--doctor`, `--preview`, Chromium under `cap_drop: [ALL]`, the passphrase secret). The image build and a plain Chromium launch are covered by CI.

Secret file: `secrets/upec-wipe-passphrase` must be mode 600 on the host
(`chmod 600 secrets/upec-wipe-passphrase`), because the tool refuses a group- or
world-readable passphrase file. The container user must be able to read it:
either `sudo chown 1001 secrets/upec-wipe-passphrase` (uid 1001 is pwuser) or run the
container as your host uid.
