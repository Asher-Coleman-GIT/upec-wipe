# Threat model

This tool submits your identity to dozens of companies on purpose. The goal of this fork is that no broker learns more than it already had, plus one throwaway email alias. A few services get more than that because their job needs it: SimpleLogin knows your real inbox, HIBP gets your real email when you run `aidr breach`, search engines get your full name and city when you run `aidr serp`, CapSolver sees which broker pages showed a CAPTCHA, and your SMTP provider sees every opt-out email you send. [PRIVACY.md](PRIVACY.md) lists every destination and exactly what it gets.

## What each layer protects

| Layer | Stops | Does not stop |
| --- | --- | --- |
| SimpleLogin alias (fail-closed: no alias, no submission) | Brokers learning your real email address. | A broker linking the alias to your name, because both are on the same form. Brokers correlating with each other: you get one alias, shared by all brokers. A broker seeing the address of the SMTP account (`email.smtp.user`) that sent an email opt-out: the alias does not hide it, so leave out the `email` block or use a separate mailbox not linked to you. SimpleLogin itself knowing your real inbox. |
| Browser network check (`network.required`, `network.proxy`) | Brokers and search engines seeing your home IP. The browser must see a Mullvad exit (or, with a proxy, an IP that differs from your direct one) before it opens any site. | The VPN dropping mid-run, unless Mullvad Lockdown mode is on (the check runs at the start). The manual-action pages opened at the end of a run: they use your everyday browser, which never goes through `network.proxy`, so only a system-wide VPN covers them. |
| Direct-connection check (same settings) | SimpleLogin, CapSolver, HIBP, SMTP, the broker registries and the `doctor` probes seeing your home IP. Before the first of these in a run the tool checks `am.i.mullvad.net` from Node and stops if you are not on Mullvad. | Proxy mode. With `network.proxy` set, these connections cannot use the proxy and go out from your real IP. The tool prints a note naming them. In proxy mode the network check itself also makes one direct request to `api.ipify.org`, which sees your real IP. Use the Mullvad app (system-wide) if that matters. |
| Throwaway browser profile (new on every run unless `browser.persistentProfile` is true) | Cookies and fingerprint state piling up across broker sites. | Per-run fingerprinting of your browser. |
| Generic pass off by default | Your data going to about 490 sites nobody reviewed. Some come from the California and Vermont registries, so whoever registers there chooses them; registry entries that are not `https` are dropped. Turning the pass on with `--generic` (or `generic.enabled`) accepts that risk. | Nothing, once you opt in. |
| Encryption at rest (`AIDR_PASSPHRASE_FILE` or `~/.config/auto-identity-remove/passphrase`) | Someone copying `config.json` off a stopped disk or out of a backup, but only if the passphrase file is not on that same disk or backup. It covers `config.json` only. | Anyone reading `state.json` (plaintext, holds your alias mapping keyed by your real email), `logs/` (plaintext; on the monthly systemd job `logs/systemd.log` gets everything printed) or the history files in `data/`. Malware running as your user while the tool runs. |
| Unprivileged user, umask 077 on every entry point, `scripts/harden.sh` | Other local accounts reading your personal data. | Root on that machine. |
| Loopback-only dashboard with a login, a Host-header check and a lockout after 10 failed logins | Anyone on the network reaching your config, and web pages you visit tricking your browser into talking to it (DNS rebinding). | Other programs on the same machine that know the login. |
| No notifications (removed from this fork) | Run results, which show which brokers hold your data, reaching a phone, a chat service or a public topic. | Nothing to add: the feature is gone, and old `notify` settings are ignored. |

## What this tool does not protect

- The confirmation step. `Submitted` does not mean `deleted`. Run `aidr verify` to check.
- Brokers adding you back later. Opt-outs have to be repeated every month.
- Your SMTP provider. It sees every opt-out email you send.
- The SMTP account itself. A broker that receives an opt-out email can see the address of the account it was sent from (`email.smtp.user`), whatever `from` says, because providers such as Gmail rewrite `From` and the account is in the envelope. The relay alias does not hide it. Leave out the `email` block (the recommended setup) or use a separate mailbox not linked to you.
- HIBP. `aidr breach` sends your real email to haveibeenpwned.com. Do not run it if that matters to you.
- Search engines. `aidr serp` and `aidr serp-watch` search for your full name with your city and state on DuckDuckGo, Bing and Google, through the VPN.
- CapSolver. It sees your account and the address of each broker page that showed a CAPTCHA. It gets no images and none of your details. Leave out the key (or use `--no-capsolver`) and those brokers become manual.
- Mullvad. It sees the traffic leaving its servers, as any VPN does.
- Installing. `install.sh` and the install steps download from npm, the Playwright CDN, NodeSource and Ubuntu's mirrors. Connect Mullvad first if you do not want those to see your home IP.
- Anyone who already has control of your user account.

## A note on proxies

`network.proxy` must be an unauthenticated local proxy, for example Mullvad's `socks5://10.64.0.1:1080`. A proxy URL that contains a username and password (`user:pass@`) is not supported. The proxy covers the browser only; see the direct-connection row above.

## Rules for the club

- One instance per member, on a machine that member controls. Never a shared server and never a shared config.
- Never paste `config.json`, `state.json`, logs or screenshots into club chat. They contain your personal data.
- Report a suspected leak privately to the fork maintainer.
