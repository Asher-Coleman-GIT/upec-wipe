# UPEC guide to auto-identity-remove

## What this does

Data brokers are companies that collect and sell your name, address and phone number. Once a month this tool works through 44 of the biggest ones (Spokeo, Whitepages, Radaris, MyLife and others): it finds your listing and files the opt-out form for you. Brokers that only take requests by email, or that need something the tool cannot do, go on a list for you to finish by hand.

It is set up here so that brokers see a throwaway email address and a VPN address instead of your real ones:

- **Your email.** SimpleLogin makes one alias for you that forwards to your real inbox. Every form gets the alias. If no alias can be made, nothing is submitted for you.
- **Your IP address.** The tool checks that Mullvad is on before it visits any site and before it contacts any other service. If the check fails, the run stops and nothing is sent.
- **Your machine.** It uses a fresh browser profile each run, files only you can read, and no notifications. Nothing reports back to anyone.

A month looks like this:

1. You run `node bin/aidr.js run` (nothing runs on its own).
2. Brokers send "confirm your request" emails to your alias, which land in your inbox. You click them.
3. Brokers you must finish by hand are listed in the summary at the end of the run, and those with a web page open in your browser. `node bin/aidr.js pending` lists only the brokers still waiting for you to click a confirmation email. Later, `node bin/aidr.js verify` checks whether you are really gone.

Some extra commands send more about you to other services: `breach` sends your real email to Have I Been Pwned, and `serp` searches for your name and city on search engines. They are off unless you run them. The command reference at the end says what each command sends, and [PRIVACY.md](PRIVACY.md) lists every destination.

## What you need before starting

- A Mullvad account (mullvad.net). You can pay without giving an email address.
- A SimpleLogin account (simplelogin.io) with an API key.
- Optional: a CapSolver account (capsolver.com) with a small balance, see below.
- About 1 hour.

Commands go in a terminal, which is a window where you type instructions. Type each command exactly, then press Enter. To paste into most terminals, right-click. Every command below sits in its own box, with a sentence before it saying what it does and a sentence after it saying what you should see.

## Before you start: Mullvad

1. Install the Mullvad app from mullvad.net/download, log in, and click Connect.
2. Open Settings, then VPN settings, and turn on **Lockdown mode**. This blocks all internet access if the VPN drops, so nothing leaks mid-run.
3. Open https://am.i.mullvad.net in a browser. It should say "You are using Mullvad".

## Before you start: SimpleLogin

1. Create an account at simplelogin.io and verify your email.
2. Go to Settings, then API Keys, then Create, and copy the key somewhere safe (a password manager is best).

Why: the tool creates one throwaway address for you that forwards to your real inbox, and gives that same address to every broker, so they never learn your real one. Because it is the same address everywhere, brokers could still match their records about you on it.

## Before you start: CapSolver (optional)

A few brokers (today BeenVerified, MyLife and FamilyTreeNow) put a CAPTCHA on their opt-out page. CapSolver is a paid service that solves these automatically, for about $0.001 each, so a few cents a month.

You can skip it. Without a key, a broker whose page shows a CAPTCHA is marked as failed in the run summary and its page opens in your browser at the end of the run, so you can solve the CAPTCHA and finish the form yourself. `--retry-failed` tries those brokers again on a later run.

If you want it:

1. Create an account at capsolver.com and add a small balance.
2. Copy your API key from the dashboard. It starts with `CAP-`.
3. Paste it when setup asks for "CapSolver API key", or later put it in `config.json` as `"capsolver": { "apiKey": "CAP-..." }`.

What CapSolver sees: your account, the address of the broker page that showed the CAPTCHA and the CAPTCHA's site key (a public code the page uses to identify its CAPTCHA). It gets no image and none of your details. It connects straight from your computer, so it is covered by the Mullvad check like everything else. To skip CapSolver for one run, add `--no-capsolver`.

## Part A: Windows (WSL2)

WSL2 gives Windows a built-in Linux. This tool runs inside it. Connect Mullvad before you start: the install steps download from several sites, and without Mullvad they see your home address.

1. Open the Start menu, type PowerShell, right-click it and choose Run as administrator. This installs Ubuntu:

   ```
   wsl --install -d Ubuntu
   ```

   It downloads for a few minutes. Restart the computer when it asks. After the restart, Ubuntu opens and asks you to pick a Linux username and password. Remember both.

2. Open "Ubuntu" from the Start menu. You will see a line ending in `$`. That is the prompt, and it is waiting for you to type. **Stay in your Linux home folder and never use `/mnt/c`.** `/mnt/c` is your Windows drive, and file permissions do not work there, so your personal data would not be locked down.

3. Install the basic tools. This updates the package list and installs git and curl (it asks for your Linux password):

   ```
   sudo apt update && sudo apt install -y git curl
   ```

   Lots of text scrolls by, then the prompt comes back. Next, add Node 20, the program this tool runs on:

   ```
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
   ```

   Check the version:

   ```
   node -v
   ```

   It should print a version starting with `v20`.

4. Download the fork into your home folder (`~`). Replace `<fork URL>` with the address the club maintainer gave you:

   ```
   git clone <fork URL> ~/auto-identity-remove
   ```

   It prints "Cloning into ..." and finishes. Move into the folder:

   ```
   cd ~/auto-identity-remove
   ```

   Nothing is printed. Run the installer, which installs the tool's parts and a browser:

   ```
   bash install.sh
   ```

   This takes several minutes. Then install the libraries the browser needs:

   ```
   npx playwright install-deps chromium
   ```

   It may ask for your Linux password and then finishes with the prompt returning.

5. Continue at **Configure** below.

## Part B: Linux

These steps are for Ubuntu or Debian. First make a dedicated user so the tool never runs as an account that holds your other files. This creates it and asks you to set a password:

```
sudo useradd -m -s /bin/bash aidr && sudo passwd aidr
```

Switch to that user:

```
sudo -iu aidr
```

The prompt now shows `aidr@`. Then do steps 3 and 4 of Part A (install git, curl and Node 20, clone, `cd`, `bash install.sh`, `npx playwright install-deps chromium`). Never run the tool with `sudo` or as root.

If you use the Mullvad command-line app instead of the desktop app, connect:

```
mullvad connect
```

Turn on lockdown mode:

```
mullvad lockdown-mode set on
```

Check it:

```
mullvad status
```

It should say "Connected".

## Configure

This part is the same for Parts A and B.

1. Optional, only if you want encryption: create an empty passphrase file that only you can read. Skip to step 2 if you do not want encryption:

   ```
   mkdir -p ~/.config/auto-identity-remove && install -m 600 /dev/null ~/.config/auto-identity-remove/passphrase
   ```

   Open it with `nano ~/.config/auto-identity-remove/passphrase`, type a long passphrase (a few random words), and save. Warning: if you lose the passphrase, your config cannot be recovered and you must run setup again.

2. Run the setup questions. This asks for your name, address and other details, and saves them in `config.json` in this folder:

   ```
   node bin/aidr.js setup
   ```

   Answer each question and press Enter. It asks for your name, aliases (other names you go by; stored but not used yet), city, country, state, zip, email and phone, your date of birth (optional: only PrivateRecords uses it, and leaving it blank sends that site to your manual list), then your CapSolver key (leave it blank to skip), then your SimpleLogin API key, then the browser profile folder (press Enter to keep the default). Your real email is stored here but never given to brokers once the relay is set. When it asks "Encrypt config.json now?", answer **n**: encryption comes last, after you have edited the file. Setup does not schedule anything: the tool runs only when you start it. It finds the passphrase in `~/.config/auto-identity-remove/passphrase` on its own.

3. Open the settings file in a simple editor:

   ```
   nano config.json
   ```

   Move with the arrow keys. To save, press Ctrl+O then Enter. To leave, press Ctrl+X. Set these three things exactly.

   The relay (your SimpleLogin key). Setup already wrote this block with the key you gave it. If you left the key blank, it holds the placeholder `YOUR_SIMPLELOGIN_API_KEY`; replace it with your key (or re-run setup). `"required": true` means nothing is submitted for you without a working alias:

   ```
   "relay": { "provider": "simplelogin", "apiKey": "<your key>", "required": true }
   ```

   The email block, used for brokers that only accept an email. **Recommended: delete the whole `email` block** and handle email-only brokers by hand. The tool lists them as manual. The reason: a broker that receives your email can see the address of the SMTP account it was sent from, whatever `"from"` says. Gmail, for example, replaces `"from"` with your Gmail address, and the account address also travels in the hidden envelope. So only keep this block if you have a separate mailbox that is not linked to you in any way, and use that mailbox for both `"user"` and `"from"`. Never use your everyday email account here. The tool refuses to send if `"user"` or `"from"` is your real email:

   ```
   "email": { "smtp": { "host": "...", "port": 587, "user": "<separate mailbox not linked to you>", "pass": "...", "from": "<the same separate mailbox>" } }
   ```

   The network check, also written by setup. `"required": true` makes the tool stop unless Mullvad is on. Leave `proxy` empty if you use the Mullvad app:

   ```
   "network": { "required": true, "proxy": "" }
   ```

   If you use a proxy instead, set `proxy` to an unauthenticated local one such as `socks5://10.64.0.1:1080`. A proxy address with a username and password in it (`user:pass@`) is not supported, so use an unauthenticated local proxy like that one. The config file may also contain a `notify` block from older versions. Notifications were removed from this fork, so you can delete that block.

4. Lock down file permissions:

   ```
   bash scripts/harden.sh
   ```

   You should see "Permissions hardened". If it says chmod has no effect, you are on `/mnt/c`. Go back to Part A step 2 and redo the install in your Linux home folder.

5. Optional: encrypt your config. Skip this if you did not create a passphrase file in step 1:

   ```
   AIDR_PASSPHRASE_FILE=~/.config/auto-identity-remove/passphrase node watcher.js --encrypt-config
   ```

   It reports that the config was encrypted. Afterward, plain commands such as `node bin/aidr.js doctor` and `node bin/aidr.js run` work without the `AIDR_PASSPHRASE_FILE=...` prefix, because the tool reads `~/.config/auto-identity-remove/passphrase` by default. Keep that file mode 600: the tool refuses it if other users can read it. If you keep the passphrase somewhere else, put `AIDR_PASSPHRASE_FILE=<path>` in front of each command instead.

6. Check that everything is ready:

   ```
   node bin/aidr.js doctor
   ```

   It prints a list of checks. Fix anything marked as a problem before you continue. The SMTP, CapSolver and SimpleLogin checks connect to those services, so they wait for the same network check as a run: with the Mullvad app off they say "skipped: not on Mullvad". It also works after you encrypt your config.

7. Rehearse a run with `aidr preview` (you run it as `node bin/aidr.js preview`). Make sure Mullvad is connected first. It does everything except submit:

   ```
   node bin/aidr.js preview
   ```

   Nothing is submitted. Expect a line with `Network: Mullvad exit`. A preview writes no log file and saves no state: the summary on screen is the whole result, so read it there. Now do the real run:

   ```
   node bin/aidr.js run
   ```

   It works through the brokers for a while and prints a summary at the end.

## Part C: Docker

**Not supported yet. Do not use until the Docker verification in FORK.md is done.** Use Part A or Part B instead. The steps below are kept for the maintainer who runs that verification. They use a plain (unencrypted) `config.json`, because encryption has not been checked under Docker either.

1. Install Docker Desktop (on Windows, enable the WSL2 backend), or on Linux install `docker.io`. Keep Mullvad connected on the host computer.
2. Clone into your home folder as in Part A step 4, then copy the example config:

   ```
   cp config.example.json config.json
   ```

   Edit it with `nano config.json` as in Configure step 3.

3. Create the files Docker mounts. This makes an empty state file and a logs folder:

   ```
   touch state.json && mkdir -p logs
   ```

   Remove the `secrets` lines from `docker-compose.yml`.

4. Build the image:

   ```
   docker compose build
   ```

   It takes a few minutes. Then rehearse:

   ```
   docker compose run --rm watcher node watcher.js --dry-run
   ```

   Nothing is submitted. Then the real run:

   ```
   docker compose run --rm watcher
   ```

## Part D: Every month

1. Connect Mullvad.
2. Run the tool:

   ```
   node bin/aidr.js run
   ```

   With Docker, use `docker compose run --rm watcher` instead.

3. Check your SimpleLogin inbox for "confirm your request" emails and click each link. The tool cannot do this part, so you must.
4. Every few months, check you are really gone with `node bin/aidr.js verify`.
5. See which brokers still need you:

   ```
   node bin/aidr.js pending
   ```

   It lists opt-outs waiting for a confirmation or a manual step.

## Dashboard (optional)

A web page for browsing results. It only works on this computer.

```
node bin/aidr.js dashboard
```

It prints a web address and a login. Open that address in your browser and use that login. `127.0.0.1` or `localhost` with the printed port both work; any other name is refused with a `misdirected request` error, which protects against web pages that try to reach the dashboard. After 10 wrong logins in 15 minutes it locks for the rest of that window. New passwords set in the Admin tab must be at least 12 characters.

## Command reference

Run each as `node bin/aidr.js <command>`. "Sends" lists what leaves your computer; see [PRIVACY.md](PRIVACY.md) for details.

| Command | What it does | Sends |
| --- | --- | --- |
| `setup` | Asks for your details and writes `config.json`. | Nothing. |
| `doctor` | Checks your setup, including that SimpleLogin accepts your key. | After the network check passes: a connection to your SMTP host, one request to CapSolver, and one read-only request to SimpleLogin with your key (it creates no alias). |
| `preview` | Rehearses a run: opens every broker and fills the forms, submits nothing. Does not call CapSolver or open pages in your everyday browser. | Your name in each broker's search page. |
| `run` | The real opt-out pass. | Brokers: your name, city, state, zip and your alias. SimpleLogin: a request for your alias the first time. CapSolver: CAPTCHA pages, if you set a key. Your SMTP server: email opt-outs, only if you kept the `email` block. |
| `pending` | Lists brokers waiting for you to click a confirmation email. Brokers that need a manual step are in the run summary instead. | Nothing. |
| `verify` | Searches the brokers again to see if you are still listed, and saves the result. | Your name in each broker's search page. |
| `list` | Lists the brokers and their last status. | Nothing. |
| `score` | Prints your exposure score (0 to 100) and its trend. | Nothing. |
| `report` | Saves a monthly PDF report on this computer. | Nothing. |
| `complaints` | Writes regulator complaints for brokers past the legal deadline, for you to file. | Nothing. |
| `freeze` | Shows the credit-freeze checklist (Equifax, Experian, TransUnion and others). | Nothing. |
| `know` | Sends "what do you hold about me" requests under the California (CCPA) or European (GDPR) privacy law, to the brokers that take requests by email. Without the `email` block it prints the text for you to send. | SimpleLogin: a request for your alias if none exists yet. With the `email` block, also your SMTP server and those brokers: your name, city, state, zip, phone and alias. |
| `breach` | Checks Have I Been Pwned for breaches. Needs `hibp.apiKey`. | **Your real email** to haveibeenpwned.com. |
| `serp` | Searches DuckDuckGo, Bing and Google for your name. | `"<your full name>" "<city>, <state>"` to those search engines. |
| `serp-watch` | Like `serp`, and lists sites where your name is new since last time. | Same as `serp`. |
| `update-brokers` | Refreshes the extra broker list from the California and Vermont registries. | Nothing about you. |
| `dashboard` | Starts the local web page. | Nothing. Runs started from it send what the command would. |

Useful options for `run` and `preview`: `--assist` (when a site shows a bot check such as Cloudflare's "Just a moment...", the run waits up to 3 minutes for you to complete it in the browser window, then fills and submits by itself; needs a visible window), `--only <broker>` and `--skip <broker>` (limit to or leave out brokers), `--resume` (carry on after an interrupted run), `--retry-failed` (only the brokers that failed last time), `--no-capsolver` (treat CAPTCHA brokers as manual) and `--generic` (also try about 490 smaller sites from public lists; off by default because nobody reviewed them). `--allow <broker>` stops opting out of a broker you want to stay listed on, and `--unallow <broker>` undoes that.

## Troubleshooting

| Message | What to do |
| --- | --- |
| `Network check failed - nothing was submitted. ...` | Connect Mullvad and check https://am.i.mullvad.net says you are using it. Then run again. |
| `Skipping person #N: Relay alias creation failed: ...` | Check the SimpleLogin API key in `config.json` and that your SimpleLogin account is verified. |
| `config.relay.required is true but no usable relay is configured (provider "simplelogin" + apiKey)` | Add your SimpleLogin key as `apiKey` in the `relay` block. |
| `... relay.apiKey is still the placeholder. ...` | Setup wrote `YOUR_SIMPLELOGIN_API_KEY` as a placeholder. Replace it with your SimpleLogin API key in the `relay` block. Until then nothing is submitted. |
| `Refusing to run as root. ...` | Do not use `sudo` or a root account for the tool. Use your own user (Part B). |
| `chmod has no effect on ... (mode came back ...)` | You are on `/mnt/c`. Move the install to your Linux home folder (Part A step 2). |
| `Passphrase file ... is readable by other users. Run: chmod 600 "..."` | Run the `chmod 600` command it prints. |
| `... - not sent: email.smtp.from ... Set email.smtp.from to a non-real address.` | Your `"from"` is missing or is your real email. Set it to a non-real address. |
| `... - not sent: email.smtp.user ... Use a separate SMTP mailbox that is not linked to you, or remove the email block ...` | Your SMTP login is your real email and brokers can see it. Switch to a separate mailbox not linked to you, or delete the `email` block and handle those brokers by hand. |
| `aidr-dashboard: AIDR_HOST=... is not a loopback address. ...` | Unset `AIDR_HOST` so the dashboard stays on this computer. |
| `Network check failed for direct connections - nothing was sent. ...` | The tool was about to contact SimpleLogin, CapSolver, HIBP, your SMTP server or a registry, and Mullvad is off. Connect the Mullvad app and run again. |
| `Note: network.proxy covers the browser only. ...` | You set `network.proxy`. Brokers see the proxy, but those services see your real IP. Use the Mullvad app instead if that matters to you. |
| `Playwright is not installed. Run: npm ci --ignore-scripts && npx playwright install chromium` | Run that command in the tool's folder. |
| `misdirected request: unexpected Host header` (dashboard) | Open the address the dashboard printed (or `localhost` with the same port). |
| `too many failed login attempts; try again later` (dashboard) | Wait up to 15 minutes, then log in with the printed login. |
| `blocked by bot protection - open in your normal browser: <link>` | The site blocks automated browsers or VPN addresses. Run again with `--assist` and complete the check in the browser window when asked. If the page says "you have been blocked" or "Error 1005", the site refuses this Mullvad server: switch servers or open the link yourself. |
| `... (check not completed in time) - open in your normal browser: <link>` | `--assist` waited 3 minutes and the check did not clear. Open the link yourself, or run that broker again with `--assist --only <broker>`. |
| `form not recognised (none of your details could be filled) - do it by hand: <link>` | The site changed its form, so nothing was submitted. Open the link and fill it in yourself. `node scripts/inspect-broker-forms.js <broker>` shows the current form so the definition can be updated. |
| `config.json is not valid JSON` (any command) | A hand edit broke `config.json`. Open it with `nano config.json` and look for a missing comma or quote near where you last edited. The message never shows the broken line, so your details stay out of logs. |
| `Warning: ... (serp-key) is damaged; replacing it. ...` | Harmless. Your search-scan history starts over once. |
| `ℹ  notify settings in config.json are ignored in this fork.` | Harmless. Notifications were removed, so you can delete the `notify` block. |

Before you rely on this, read [THREAT-MODEL.md](THREAT-MODEL.md) to see what it does and does not protect.
