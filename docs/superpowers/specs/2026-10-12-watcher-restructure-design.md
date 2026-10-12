# Plan B: write paths, small fixes, watcher restructure (2026-10-12)

Follows `2026-10-12-perf-followups-design.md` (Plan A, merged locally into `upec/hardening` at 4dd16f2). The member asked for the two items Plan A measured and dropped, the five small issues Plan A's review left, and the `watcher.js` restructure.

## 1. `saveState` writes the data once

Today every save serialises the state and writes it twice: `state.json` (tmp, fsync, rename) and `state.json.bak` (a second tmp and rename). After this change the `.bak` is a hard link to the file just written, so no second write is needed. The contract tests keep holding: the `.bak` is byte-identical to `state.json` after a save, and the state can be recovered from it.

The shared inode must never be written in place. When the primary rename falls back to an in-place rewrite (a bind-mounted file: EBUSY, EXDEV or EPERM), the `.bak` first gets its own copy of the old state. Where hard links are not supported, the `.bak` is written as data, as today.

## 2. `fillForm` makes fewer browser round trips

Each field took `count()`, `isVisible()` and two `evaluate()` calls before its fill. `isVisible()` already returns false when nothing matches, and one `evaluate()` can return both the tag and the type. That makes 2 round trips per field instead of 4, on all three paths: selector, label and resolver.

## 3. Small issues from Plan A's review

- A logged bounce moves the broker to manual even though the email was sent, for both `--email` and `know`. `reply <broker> <outcome> --right-to-know` logs a reply to a right-to-know request.
- `lib/catalog.js` takes `BARE_SUFFIXES` from `lib/domain.js`.
- The preview note says "preview or dry run".
- The stray blank lines are removed from `lib/captcha.js`.
- The two wiring checks that were only source-text tests (the explicit-loop counter across persons, and `know` checking setup before the alias) become behaviour tests. They come with the restructure.

## 4. `broker-runner` options per runner

`createBrokerRunner(options)` returns a runner bound to its own options. The run mode builds one per person. `configure()`/`processBroker()` stay as a default runner for existing callers and tests.

## 5. `watcher.js` restructure

- `watcher.js` becomes a short entry point. In order, it:
  - sets the umask;
  - refuses running as root, `--pollute` and `--install-scheduler`;
  - parses the flags (`lib/cli-flags.js` `parseWatcherFlags`);
  - refuses `--email --verify` and `--assist` without a window;
  - picks one mode (`lib/mode-dispatch.js` `pickMode`, the same precedence as today, with the conflict check at the same point);
  - runs `lib/modes/<mode>.js`.
- One file per mode under `lib/modes/`: freeze, encrypt-config, list, reply, score, pending, allowlist, know-status, breach, complaints, confirm-emails, report, doctor, update-brokers, know, run.
- Shared helpers live in `lib/modes/shared.js`: the state lock, the terminal prompt, the email-step wiring, the preview note, and the run setup.
- The mode bodies move verbatim, apart from mechanical path and `argv` edits.
- Behaviour for every command is unchanged. The CLI tests that spawn `watcher.js` are the check.

## Out of scope

- `stateKey` keying (the member chose to skip it).
- Converting every `process.exit` inside a mode into a return code. Modes may still exit for errors; the entry point exits with a mode's returned code.
