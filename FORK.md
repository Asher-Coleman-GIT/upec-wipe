# UPEC hardened fork

Fork of https://github.com/stephenlthorn/auto-identity-remove pinned at the commit in
`UPSTREAM_BASE`. See `docs/superpowers/specs/2026-10-07-upec-hardened-fork-design.md`
for what changed and why.

Runs are manual only. Setup installs no scheduled job, and there is no
`--install-scheduler` or dashboard Schedule tab.

## Pulling upstream changes

    bash scripts/upstream-review.sh | less

Read the whole diff. Upstream is largely AI-written and changes quickly. Only then
merge by hand and write the reviewed commit SHA into `UPSTREAM_BASE`.

## Setting it up

Follow [docs/UPEC-MANUAL.md](docs/UPEC-MANUAL.md). Read
[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) to know what it does and does not protect.

## Docker verification

Status: pending manual verification on a Docker host. No Docker was available when
the compose hardening (`user: pwuser`, `cap_drop: [ALL]`, `no-new-privileges`,
passphrase secret) was written, so none of it has been run.

Commands to run on a Docker host:

    docker compose build && docker compose run --rm watcher node watcher.js --doctor
    docker compose run --rm watcher node watcher.js --dry-run --only Spokeo

Still to confirm: that Chromium launches under `cap_drop: [ALL]`. Its own sandbox
needs user namespaces, which dropping all capabilities can block. If launch fails,
check what `buildLaunchOptions` passes in Docker (`grep -n "sandbox" lib/browser.js`).
Do not add `SYS_ADMIN` back. Record the outcome here once checked.

## Still to verify

- The Docker steps above (build, `--doctor`, `--dry-run`, Chromium under `cap_drop: [ALL]`, the passphrase secret).

Secret file: `secrets/aidr-passphrase` must be mode 600 on the host
(`chmod 600 secrets/aidr-passphrase`), because the tool refuses a group- or
world-readable passphrase file. The container user must be able to read it:
either `sudo chown 1001 secrets/aidr-passphrase` (uid 1001 is pwuser) or run the
container as your host uid.
