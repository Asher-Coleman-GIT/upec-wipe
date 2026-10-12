# Performance and review follow-ups (Plan A) (2026-10-12)

Follows `2026-10-12-review-overhaul-design.md`, merged locally into `upec/hardening` at 90f300f. This is Plan A of two; Plan B splits `watcher.js` into a mode table and is written after this one lands.

Decisions taken with the member:
- `stateKey` keying stays as it is (one-person household; no state.json migration).
- The watcher split is a separate, later plan.

## Measured and dropped

- `saveState` double write: 36 ms per save on /mnt/c with a 58 KB state, about 2 saves per broker, against 5-15 s of deliberate delay per broker. Not worth touching crash-safety code.
- `fillForm` browser round trips: the same order of magnitude (well under a second per broker against the same delay). Dropped.
- `broker-runner` module-level options: moved to Plan B, where the runner wiring changes anyway.

## In scope

1. **Dashboard catalog cache.** `/api/brokers` reads all 641 catalog files on every call (about 2.5 s on /mnt/c). The dashboard keeps the records for 60 s (`cachedCatalogLoader`).
2. **One SERP-history reader.** `watcher.js` reads `data/serp-history.json` by hand in two places; both use `lib/serp-scan.js` `readHistory()`.
3. **`registrableDomain` knows two-label suffixes.** Using the suffix list the catalog already has (`co.uk`, `org.uk`, `com.au`, `net.au`, `co.nz`, `co.za`, `com.br`, `co.jp`), `x.broker.co.uk` reduces to `broker.co.uk`, not `co.uk`. The list moves to `lib/domain.js`.
4. **Email and know follow-ups.**
   - Stop messages name the real command: `upec-wipe run --email` and `upec-wipe know`.
   - `know` moves a broker to manual after 2 failed sends or a logged bounce (as `--email` does) and sends one request per address per person.
   - `--know` checks the email setup before it can create a SimpleLogin alias.
5. **Egress follow-ups.**
   - The generic pass re-checks egress before its first broker, and the explicit loop's counter runs across persons.
   - A VPN drop in the generic pass stops the run the same clean way as in the explicit loop: message, state saved, session closed, exit code 1.
6. **Test hardening.** A failing egress gate in `runKnowStep` sends nothing; a resend cut by the cap stays `unknown`; concurrent egress checks share one fetch; a failure stays cached past the TTL.
7. **Small text fixes.** The preview alias note, the `dob.test.js` header, the CapSolver result URL constant, and the generic-runner header order.

## Out of scope (rulings)

- `reply` for right-to-know requests; relay error messages that mention `required: false`; swallowed click errors in the generic pass.
