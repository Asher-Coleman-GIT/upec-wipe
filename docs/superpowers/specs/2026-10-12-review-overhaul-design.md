# Review overhaul: privacy gaps, speed and cleanup (2026-10-12)

Source: a full read of the code paths that send personal data or touch the network (watcher, generic-runner, broker-runner, forms, relay, egress, email-step, right-to-know, config/state, catalog, captcha, dashboard server, CLI). Suite before the work: 1854 pass, 0 fail, 84 s.

Scope agreed with the member: privacy fixes P1-P6, the performance items, and the cleanup items. Splitting `watcher.js` into a mode table is a separate later plan.

## Privacy fixes

- **P1 Relay fails closed by default.** `relayRequired(config)` is true unless `relay.required === false`. A config with no `relay` block, or with no `required` key, no longer sends the real email: the person is blocked. Only an explicit `relay.required: false` allows the real email.
- **P2 One email sender.** `--know` (right-to-know) uses the `--email` step's gates and sender: `checkEmailSetup` (dedicated mailbox, no `network.proxy`, interactive terminal), the typed `SEND`, egress re-check before every send, pacing, the per-run cap, record before and after each send. A know request is never sent twice to the same broker for the same person. Its state keys are `know:<stateKey>` in `state.emailSent`, so they never collide with opt-out email keys. The old `sendKnowRequests` and its no-SMTP template print are removed.
- **P3 Egress is re-checked during long runs.** `ensureNodeEgress` trusts a passed check for 5 minutes (`NODE_EGRESS_TTL_MS`), then checks again; a failure stays cached; `{ fresh: true }` forces a check (used before every email). The browser session exposes `recheckEgress()`, which the explicit-broker loop and the generic pass call every 10 brokers; a failure stops the run with an `EgressError`.
- **P4 Breach check asks first.** `--breach-check` keeps working but needs an interactive terminal and the member typing `YES` after a notice that the real addresses go in full to haveibeenpwned.com.
- **P5 No false success from cookie managers.** The generic pass no longer clicks privacy-manager buttons (`#accept-recommended-btn-handler` is OneTrust's "Allow All"; any button saying Save or Confirm also matched) or reports them as an opt-out. A cookie choice in a throwaway profile is lost when the profile is deleted, so it is never a success.
- **P6 The cap holds.** Interrupted sends the member chooses to resend count toward `maxPerRun` and go first.

## Performance

- `--list` reads the catalog once (each read is about 2.5 s on /mnt/c).
- The generic pass checks the cookie-banner and Do Not Sell selector lists as one locator each (`<list> >> visible=true`) instead of one `count()` + `isVisible()` per selector. The first visible match in document order wins.
- Out of code scope, for the member: moving the clone from `/mnt/c` to the WSL ext4 filesystem cut the raw catalog read from 2617 ms to 20 ms in a measurement.

## Cleanup

- Delete the unused opt-out email sender (`lib/email.js` `sendOptOutEmails` and helpers) and the tests that only cover it.
- One CapSolver round-trip helper behind the five solvers, log text unchanged.
- `hostnameOf` / `registrableDomain` move to `lib/domain.js` (behaviour unchanged; serp-scan re-exports them).
- `generic-runner.js` takes `RECHECK_DAYS` from `lib/config`.
- One `acquireStateLockOrExit()` in watcher replaces five copies; `reply` takes the lock and reloads state under it.
- No emoji (Extended_Pictographic) in tracked non-test JS outside `dashboard/public/`, enforced by a test.
- Dashboard header comment names the real token header (`X-UPEC-WIPE-Token`).

## Out of scope (later)

- Splitting `watcher.js` into a mode table; the `broker-runner` module-level options.
- `stateKey` changes when the number of persons changes (orphans history).
- A real public-suffix-aware `registrableDomain`.
