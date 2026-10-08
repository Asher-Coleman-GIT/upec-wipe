# Threat model

This tool submits your identity to hundreds of companies on purpose. The goal of this fork is that each company learns nothing it did not already have, plus a throwaway email alias, and that nobody else learns anything at all.

## What each layer protects

| Layer | Stops | Does not stop |
| --- | --- | --- |
| SimpleLogin alias (fail-closed: no alias, no submission) | Brokers learning your real email address. | A broker linking the alias to your name, because both are on the same form. |
| VPN/proxy egress check (`network.required`, `network.proxy`) | Brokers and search engines seeing your home IP address. | It does not cover CapSolver, HIBP, SimpleLogin or SMTP traffic unless the VPN is system-wide (the Mullvad app). It does not survive the VPN dropping mid-run unless Mullvad Lockdown mode is on. |
| Throwaway browser profile (new on every run unless `browser.persistentProfile` is true) | Cookies and fingerprint state piling up across broker sites. | Per-run fingerprinting of your browser. |
| Generic pass off by default | Your data going to about 490 sites nobody reviewed. Turning it on with `--generic` (or `generic.enabled`) accepts that risk. | Nothing, once you opt in. |
| Encryption at rest (`AIDR_PASSPHRASE_FILE`) | Someone copying `config.json` off a stopped disk or out of a backup. | Malware running as your user while the tool runs. |
| Unprivileged user or Docker, umask 077, `scripts/harden.sh` | Other local accounts reading your personal data. | Root on that machine. |
| Loopback-only dashboard | Anyone on the network reaching your config. | Other programs on the same machine (the dashboard still has a login). |
| No notifications (removed from this fork) | Run results, which show which brokers hold your data, reaching a phone, a chat service or a public topic. | Nothing to add: the feature is gone, and old `notify` settings are ignored. |

## What this tool does not protect

- The confirmation step. `Submitted` does not mean `deleted`. Run `aidr verify` to check.
- Brokers adding you back later. Opt-outs have to be repeated every month.
- Your SMTP provider. It sees every opt-out email you send.
- CapSolver. It sees which broker pages you visit when it solves a CAPTCHA.
- Anyone who already has control of your user account.

## A note on proxies

`network.proxy` must be an unauthenticated local proxy, for example Mullvad's `socks5://10.64.0.1:1080`. A proxy URL that contains a username and password (`user:pass@`) is not supported, so use an unauthenticated local proxy.

## Rules for the club

- One instance per member, on a machine that member controls. Never a shared server and never a shared config.
- Never paste `config.json`, `state.json`, logs or screenshots into club chat. They contain your personal data.
- Report a suspected leak privately to the fork maintainer.
