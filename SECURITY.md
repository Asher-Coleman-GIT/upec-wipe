# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private reporting: **Security → Advisories → Report a vulnerability**
on this repository. That creates a private thread visible only to the maintainer.

If private advisories are unavailable to you, open a public issue titled
`security contact request` with no details, and you will be given a private
channel.

Expect a first response within 7 days. This is a spare-time project maintained by
one person, so please be patient rather than escalating publicly.

## What this tool holds, and what a bug can cost

This is not an ordinary utility. `config.json` contains:

- legal name, home address, date of birth (optional), email address
- optionally: an SMTP app password for the dedicated mailbox, a CapSolver API key and a SimpleLogin relay key

`state.json` contains the complete record of which brokers you have contacted and
when. That record is itself sensitive: it is a list of sites that hold data about
you.

So the bugs that matter most here are the ones that:

1. Move PII somewhere unintended - a log, an error message, an email,
   another local user via file permissions, a third-party site chosen by a remote
   registry rather than by you, or the wrong form field.
2. Submit one person's PII under another person's opt-out request.
3. Report a removal that never happened. The entire output of this tool is "here
   is what was removed"; a false success is worse than a crash, because you stop
   worrying about a listing that is still live.

Reports in those categories are treated as security issues even if they need no
attacker at all.

## In scope

- Anything in the three categories above
- Command or argument injection through config values, feed data, or email content
- SSRF via a URL that came from a remote broker registry or a catalog record
- Weaknesses in the at-rest encryption (`lib/secrets.js`)
- Secrets leaking to stdout, `ps` or logs

## Out of scope

- Broker sites changing their DOM so a selector stops matching. This is expected
  and continuous; see `STATUS.md`. File it as a normal issue.
- CAPTCHA solving being blocked or failing.
- Rate limiting or bot detection by a broker.
- Anything requiring an attacker who already has your local user account. If they
  can read your home directory, they have `config.json`.
- Dependency advisories with no reachable path in this code. Say which call path
  reaches it and it becomes in scope.

## Hardening you should actually do

```bash
# 1. Encrypt the config at rest. The passphrase lives in
#    ~/.config/upec-wipe/passphrase (mode 600) or UPEC_WIPE_PASSPHRASE_FILE.
node watcher.js --encrypt-config

# 2. Confirm the PII files are owner-only. The tool writes 0600, but a file you
#    copied in from another machine keeps whatever mode it arrived with.
chmod 600 config.json config.json.enc state.json 2>/dev/null
ls -l config.json state.json

# 3. Use a relay/alias email for submissions rather than your real address.
#    See docs/relay.md.

# 4. Never commit config.json or state.json. Both are gitignored; verify with:
git check-ignore -v config.json state.json
```

## Review process

This codebase was largely written by an AI model, and the review loop initially
used the same model family - which
[issue #8](https://github.com/stephenlthorn/auto-identity-remove/issues/8)
correctly identified as an echo chamber. There is now a cross-model review
requirement for every file that touches PII, crypto, subprocesses or untrusted
network input. See [docs/CROSS_MODEL_REVIEW.md](docs/CROSS_MODEL_REVIEW.md),
including its honest account of what that does and does not buy you.
