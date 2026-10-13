# `clear` and `clear-all` (2026-10-13)

Follows `2026-10-13-retire-commands-design.md` and lands after it, so `clear-all` cleans up after the removed commands without depending on them.

A member who leaves the club, hands the machine on, or wants to start over needs a reliable way to remove what UPEC-WIPE saved. Today that means knowing every file by heart.

Decisions taken with the member:
- `clear` removes the setup only (option A): history and logs stay, so a member can rerun setup without the tool forgetting what it already sent.
- `clear-all` removes everything the tool saved on this machine.

## Commands

### `upec-wipe clear`

Deletes, when present:
- `config.json`
- `config.json.enc`
- the default passphrase file `~/.config/upec-wipe/passphrase`.

When `UPEC_WIPE_PASSPHRASE_FILE` points elsewhere, that file is listed as "kept (set by UPEC_WIPE_PASSPHRASE_FILE): delete it yourself if you no longer need it" and is not deleted: it may live somewhere shared.

### `upec-wipe clear-all`

Deletes everything `clear` deletes, plus, when present:
- `state.json`, `state.json.bak`, `state.json.tmp`, `state.json.checkpoint`, `state.json.checkpoint.tmp` (or the same names next to `UPEC_WIPE_STATE_PATH` when it is set);
- `logs/` (the whole directory);
- `data/serp-history.json`, `data/.serp-key` (or `UPEC_WIPE_SERP_KEY_PATH` when set);
- leftovers from retired commands: `data/exposure-history.json`, `data/exposure-history.json.bak`, `inbox/`. (`logs/snapshots/` and `logs/reports/` go with `logs/`.)

It never touches repo files: `data/catalog/`, `data/feeds-brokers.json`, `data/dead-urls.json`, the source lists, `node_modules/`, code.

## Behaviour

1. **List first**, before any other check, so a refusal still shows what would go. Print each path that exists and will be deleted, with its size (directories: total size and file count). Paths that do not exist are skipped silently. If none exists: print `Nothing to clear.` and exit 0.
2. **Say what it cannot reach.** Always print:
   - `This does not delete: your SimpleLogin alias (delete it at simplelogin.io), emails already sent or opt-outs already submitted, your dedicated mailbox, copies brokers hold, or any backup of this folder.`
   - `Files are deleted normally, not overwritten: on SSDs and on WSL's /mnt/c an overwrite does not reliably destroy the old data.`
   - `clear-all` adds: `The next "run --email" will email every broker again, and your logged replies will be gone.`
3. **Confirm.** Needs an interactive terminal: stdin and stdout are TTYs. Otherwise print `clear needs an interactive terminal: nothing was deleted.` and exit 1. Prompt `Type CLEAR to delete these files:` (for `clear-all`: `Type CLEAR ALL to delete these files:`). Any other answer, or closed input: `Nothing was deleted.` and exit 1. There is no `--yes` flag.
4. **Not during a run.** Take the state lock (`lib/lock.js`, the path `STATE_PATH + '.lock'` that runs use) before deleting; if a run holds it, print `A run is in progress (state.json.lock): nothing was deleted.` and exit 1. Releasing the lock removes `state.json.lock`, so it is not listed. If the state directory does not exist, no run can hold the lock and clear proceeds without it; any other lock error is printed by its code and nothing is deleted.
5. **Delete and report.** `fs.rmSync(path, { recursive: true, force: true })` for each listed path, in the listed order. Print `Deleted <path>` for each, then `Done. Run "upec-wipe setup" to start again.` A path that fails to delete prints `Could not delete <path>: <error code>` (no message text, which can carry paths), the rest continue, and the exit code is 1.
6. **Never runs as root** (the existing `exitIfRoot`), and loads no config: it must work when the config is broken or encrypted without the passphrase.

## Design

- `lib/modes/clear.js`:
  - `planClear({ all, root, home, env }) -> { remove: string[], keep: { path, reason }[] }`: pure apart from `fs.existsSync`/`fs.statSync`; returns absolute paths that exist.
  - `describePlan(plan) -> string[]`: the listing lines with sizes.
  - `runClear({ all, root, home, env, input, output, isTTY, lock }) -> Promise<number>`: prompts, locks, deletes, returns the exit code. Everything injectable for tests.
  - `run({ flags, argv })`: the mode entry, wiring the real `process.stdin`, `process.stdout`, `os.homedir()`, `process.env` and repo root.
- `watcher.js` flags `--clear` and `--clear-all`; `lib/mode-dispatch.js` routes both to `clear` (before any mode that loads config); `bin/upec-wipe.js` / `lib/cli-map.js` add `clear` and `clear-all` with help lines `Delete your setup (config and passphrase); keeps history` and `Delete everything UPEC-WIPE saved on this machine`.
- Docs: a "Starting over or leaving" section in `docs/UPEC-MANUAL.md`; the command tables in README, the manual and REFERENCE; PRIVACY's "What stays on your machine" names the two commands.

## Testing

Every test runs against a temp directory holding dummy files and a temp `home`. No test spawns `clear` against the real tree: before the mode exists, or with a wrong root, a run could delete the member's real config.

- `planClear`: `clear` lists the config files and default passphrase; `clear-all` adds the state family, `logs/`, the serp files and the leftovers; missing paths are left out; a custom `UPEC_WIPE_PASSPHRASE_FILE` is in `keep`, not `remove`; `UPEC_WIPE_STATE_PATH` and `UPEC_WIPE_SERP_KEY_PATH` are honoured; repo files (`data/catalog/x.json`, `data/feeds-brokers.json`) are never listed.
- `runClear`: no TTY refuses and deletes nothing; a wrong word and closed input refuse; `CLEAR` deletes exactly the plan; `clear-all` needs `CLEAR ALL` (plain `CLEAR` refuses); a held lock refuses; a failing delete reports the code, continues, exits 1; "Nothing to clear." when empty.
- The mode loads no config: a source test that `lib/modes/clear.js` does not require `../config`'s `loadConfig`, and dispatch puts `clear` before modes that do.
- `--help` lists both commands.

Then `npm test`, the personal-data check and a final review.

## Out of scope

- Deleting the SimpleLogin alias through its API (it would need the key that `clear` just deleted, and a network call from a cleanup command).
- Secure overwrite.
- Rewriting `state.json` selectively.
