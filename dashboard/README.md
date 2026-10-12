# Dashboard (optional web UI)

A small, self-contained web control panel for `upec-wipe`. It is
**optional** and additive - the CLI works exactly as before without it.

It wraps the existing tooling rather than reimplementing it:

- **Brokers** - reads `../brokers.js` and `../state.json` to show every broker,
  its method/priority/scope, and current opt-out status (success / pending /
  error / not-listed / manual), with a per-row "preview this broker" button.
- **Runs** - buttons for every CLI mode (preview, real, verify, doctor, list,
  pending, confirm-emails, retry-failed, serp-scan, snapshot) with live
  streamed output (SSE) and `--only` / `--skip` filters.
- **Config editor** - a form over `../config.json` (person, CapSolver, SMTP,
  broker accounts). Secrets (CapSolver key, SMTP password,
  account passwords) are masked in transit and preserved on save
  unless you type a new value. If `../config.json` doesn't exist yet the form is
  prefilled from `../config.example.json` and the first Save creates it (`0600`).
- **Logs** - browses `../logs/`. A dated report is written when a real run
  *completes*, so the list is empty mid-run (watch the live console instead).
- **Admin** - change the login from the browser (see *Auth* below).

The only dependency is `express`.

## Run

```bash
upec-wipe dashboard
```

It prints a one-time login. Running `node server.js` directly without `AIDR_USER`/`AIDR_PASS` refuses to start.

## Auth

Set credentials via env; the app authenticates **itself** (so it doesn't depend
on a reverse proxy for access control):

| Var | Default | Meaning |
|-----|---------|---------|
| `AIDR_PORT` | `8080` | Listen port |
| `AIDR_HOST` | 127.0.0.1 | Bind address. Must be loopback (127.x, ::1, localhost); anything else refuses to start. For remote access use ssh -L. |
| `AIDR_USER` / `AIDR_PASS` | _(unset)_ | HTTP Basic credentials. **Both must be set** for the env credentials to be active (setting only one is treated as misconfigured and logs a warning). When set, **all routes except `/api/health`** require them (browser-native login prompt). |
| `AIDR_TOKEN` | _(unset)_ | Token accepted **only** via the `X-AIDR-Token` header (for scripts/automation). Not accepted via query string. |

A request is allowed if it satisfies **either** valid Basic credentials **or** a
valid token. Cross-origin state-changing requests are rejected (CSRF defense).
If none are set the dashboard refuses to start. Credentials are
compared in constant time.

### Changing the login (Admin tab)

`AIDR_USER`/`AIDR_PASS` are the **bootstrap** credentials. When you change the
password from the **Admin** tab, the new username + a salted `scrypt` hash are
written atomically to `dashboard/.auth.json` (gitignored, `0600`), which then
**overrides** the env vars - no restart needed. Delete `.auth.json` to fall back
to the env credentials. Changing the password requires the current one. If
`.auth.json` is ever corrupt, the app **fails closed** (all logins denied) until
it is fixed or removed - it never silently downgrades to open access.

## Scheduling

Removed in this fork. Runs start only when you press a button here or run a command; there is no Schedule tab.

## Security notes

The config holds personal data and the UI can trigger real opt-out submissions,
so set `AIDR_USER`/`AIDR_PASS` (and optionally `AIDR_TOKEN` for automation). The
server binds loopback only. `/api/health` is
intentionally unauthenticated and returns only `{ ok: true }` (no path or
version disclosure).
