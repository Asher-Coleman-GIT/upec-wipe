# UPEC-WIPE manual

## What this does

Data brokers are companies that collect and sell your name, address and phone number. When you run it (about once a month), this tool works through 32 of the biggest (Spokeo, Whitepages, MyLife, PeopleConnect and others) and the reviewed sites in its catalog: it finds your listing and files the opt-out form for you. Brokers that take requests only by email get one from a separate step, if you set it up (see Email requests). Sites that need something the tool cannot do go on a list for you to finish by hand.

It is set up here so that brokers see a throwaway email address and a VPN address instead of your real ones:

- **Your email.** SimpleLogin makes one alias for you that forwards to your real inbox. Every form gets the alias. If no alias can be made, nothing is submitted for you.
- **Your IP address.** The tool checks that Mullvad is on before it visits any site and before it contacts any other service. If the check fails, the run stops and nothing is sent.
- **Your machine.** It uses a fresh browser profile each run, files only you can read, and no notifications. Nothing reports back to anyone.

A month looks like this:

1. You run `node bin/upec-wipe.js run --assist` and stay at the computer (nothing runs on its own). `--assist` lets you clear bot checks in the browser window so more sites get done.
2. Brokers send "confirm your request" emails to your alias, which land in your inbox. You click them.
3. Brokers you must finish by hand are listed in the summary at the end of the run, and those with a web page open in your browser. `node bin/upec-wipe.js pending` lists only the brokers still waiting for you to click a confirmation email, and `node bin/upec-wipe.js manual` lists the sites to finish by hand with their links. Later, `node bin/upec-wipe.js verify` checks whether you are really gone.

One extra command sends more about you to another service: `serp-watch` searches for your name and city on search engines. It is off unless you run it. The command reference at the end says what each command sends, and [PRIVACY.md](PRIVACY.md) lists every destination.

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

Several brokers (among them MyLife, FamilyTreeNow and FastPeopleSearch) put a CAPTCHA on their opt-out page; [STATUS.md](../STATUS.md) marks which. CapSolver is a paid service that solves these automatically, for about $0.001 each, so a few cents a month.

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

4. Download the tool into your home folder (`~`):

   ```
   git clone https://github.com/Asher-Coleman-GIT/upec-wipe.git ~/upec-wipe
   ```

   It prints "Cloning into ..." and finishes. Move into the folder:

   ```
   cd ~/upec-wipe
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
sudo useradd -m -s /bin/bash upec-wipe && sudo passwd upec-wipe
```

Switch to that user:

```
sudo -iu upec-wipe
```

The prompt now shows `upec-wipe@`. Then do steps 3 and 4 of Part A (install git, curl and Node 20, clone, `cd`, `bash install.sh`, `npx playwright install-deps chromium`). Never run the tool with `sudo` or as root.

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
   mkdir -p ~/.config/upec-wipe && install -m 600 /dev/null ~/.config/upec-wipe/passphrase
   ```

   Open it with `nano ~/.config/upec-wipe/passphrase`, type a long passphrase (a few random words), and save. Warning: if you lose the passphrase, your config cannot be recovered and you must run setup again.

2. Run the setup questions. This asks for your name, address and other details, and saves them in `config.json` in this folder:

   ```
   node bin/upec-wipe.js setup
   ```

   Answer each question and press Enter. It asks for your name, city, country, state, zip and email, your date of birth (optional: only a few people-search forms need it, and leaving it blank sends those sites to your manual list), then your CapSolver key (leave it blank to skip), then your SimpleLogin API key, then the "Email Requests" questions (leave the address blank to skip them; see Email requests), then the browser profile folder (press Enter to keep the default). Your real email is stored here but never given to brokers once the relay is set. When it asks "Encrypt config.json now?", answer **n**: encryption comes last, after you have edited the file. Setup does not schedule anything: the tool runs only when you start it. It finds the passphrase in `~/.config/upec-wipe/passphrase` on its own.

3. Open the settings file in a simple editor:

   ```
   nano config.json
   ```

   Move with the arrow keys. To save, press Ctrl+O then Enter. To leave, press Ctrl+X. Set these three things exactly.

   The relay (your SimpleLogin key). Setup already wrote this block with the key you gave it. If you left the key blank, it holds the placeholder `YOUR_SIMPLELOGIN_API_KEY`; replace it with your key (or re-run setup). `"required": true` means nothing is submitted for you without a working alias:

   ```
   "relay": { "provider": "simplelogin", "apiKey": "<your key>", "required": true }
   ```

   The email block, used for brokers that only accept an email. Setup writes it when you answer the "Email Requests" questions; without it, those brokers are listed for you to handle by hand. A broker that receives your email can see the address of the SMTP account it was sent from, whatever `"from"` says (Gmail replaces `"from"` with the account address, and the address also travels in the hidden envelope). So use only a new mailbox made for this and not linked to you, as both `"user"` and `"from"`. Never use your everyday email account here. The tool refuses to send if `"user"` or `"from"` is your real email:

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
   UPEC_WIPE_PASSPHRASE_FILE=~/.config/upec-wipe/passphrase node watcher.js --encrypt-config
   ```

   It reports that the config was encrypted. Afterward, plain commands such as `node bin/upec-wipe.js doctor` and `node bin/upec-wipe.js run` work without the `UPEC_WIPE_PASSPHRASE_FILE=...` prefix, because the tool reads `~/.config/upec-wipe/passphrase` by default. Keep that file mode 600: the tool refuses it if other users can read it. If you keep the passphrase somewhere else, put `UPEC_WIPE_PASSPHRASE_FILE=<path>` in front of each command instead.

6. Check that everything is ready:

   ```
   node bin/upec-wipe.js doctor
   ```

   It prints a list of checks. Fix anything marked as a problem before you continue. The SMTP, CapSolver and SimpleLogin checks connect to those services, so they wait for the same network check as a run: with the Mullvad app off they say "skipped: not on Mullvad". It also works after you encrypt your config.

7. Rehearse a run with `upec-wipe preview` (you run it as `node bin/upec-wipe.js preview`). Make sure Mullvad is connected first. It does everything except submit:

   ```
   node bin/upec-wipe.js preview
   ```

   Nothing is submitted. Expect a line with `Network: Mullvad exit`. A preview writes no log file and saves no state: the summary on screen is the whole result, so read it there. Now do the real run, staying at the computer:

   ```
   node bin/upec-wipe.js run --assist
   ```

   It works through the brokers for a while and prints a summary at the end. When a site shows a bot check (such as Cloudflare's "Just a moment..."), the browser window waits up to 3 minutes for you to complete it, then the run fills and submits that site by itself. Without `--assist` the run needs no one at the computer, but those sites go to your manual list, and the summary ends with the exact `--assist --only` command to finish them.

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
   docker compose run --rm watcher node watcher.js --preview
   ```

   Nothing is submitted. Then the real run:

   ```
   docker compose run --rm watcher
   ```

## Part D: Every month

1. Connect Mullvad.
2. Run the tool, staying at the computer so you can clear bot checks:

   ```
   node bin/upec-wipe.js run --assist
   ```

   With Docker, use `docker compose run --rm watcher` instead (Docker has no visible window, so no `--assist`).

3. Check your SimpleLogin inbox for "confirm your request" emails and click each link. The tool cannot do this part, so you must.
4. Every few months, check you are really gone. `node bin/upec-wipe.js verify --assist` re-searches the 5 brokers whose search it can read (Spokeo, WhitePages, FastPeopleSearch, MyLife and USPhonebook); most show a bot check, which you complete in the browser window. `node bin/upec-wipe.js serp-watch` searches DuckDuckGo, Bing and Google for your name and city and lists any broker site where you are new; it sends your name and city to those search engines.
5. See which brokers still need you:

   ```
   node bin/upec-wipe.js pending
   node bin/upec-wipe.js manual
   ```

   `pending` lists opt-outs waiting for you to click a confirmation email. `manual` lists every site a run handed to you (bot checks, CAPTCHAs it could not solve, sites with no form it can fill), with the reason and the link, oldest first. When you finish one, or click its confirmation link, mark it: `node bin/upec-wipe.js done "<name>"` (quote names with spaces; several names at once work too, and if one is unknown nothing is marked). It drops off both lists, and runs skip it for 90 days before checking it again. For a run made before runs saved this list, `node bin/upec-wipe.js manual --import-last-run` loads it from the newest run log in `logs/`.

6. If you send email requests: replies arrive in the dedicated mailbox. Log each one with `node bin/upec-wipe.js reply <broker> honored|refused|verify|none|bounced`.

## Email requests

Some data brokers only take privacy requests by email. These are sent by a separate step, never by a normal run.

1. Create a new Gmail account used only for this. Turn on 2-step verification and create an app password (myaccount.google.com/apppasswords).
2. Run `node bin/upec-wipe.js setup` and answer the "Email Requests" questions: the new address, the SMTP server (Enter for `smtp.gmail.com`) and the app password. Setup writes the `email` block with that address as both `smtp.user` and `smtp.from`, and refuses your everyday email. Brokers see only this address. (You can also edit the `email` block in `config.json` by hand.)
3. Connect Mullvad, then rehearse: `node bin/upec-wipe.js preview --email`. It lists every broker, the sentence from its policy that gives the right, and the full email. Nothing is sent.
4. Send: `node bin/upec-wipe.js run --email`. Type `SEND` to confirm. Emails go out one every 45 seconds; leave it running. If it stops (the mailbox limit, Ctrl-C), run it again later; it never emails a broker twice. To send to just one broker, use `run --email --only "<broker>"` with the exact name `upec-wipe list` shows (`--skip` works the same way).
5. Replies arrive in the new Gmail. Log each one: `node bin/upec-wipe.js reply <broker> honored|refused|verify|none|bounced`. `upec-wipe list` shows each email broker's status.

`upec-wipe run` on its own (or `--forms`) fills web forms only, and ends with a reminder such as "Email requests not yet sent: 12 - run `upec-wipe run --email`". `--forms --email` does both.

## Credit and identity freezes

A freeze stops new credit or accounts being opened in your name. It is free, and you can lift it for a day when you apply for credit. The tool does not do this for you; each takes a few minutes on the bureau's site.

| Where | What it blocks |
| --- | --- |
| [Equifax](https://www.equifax.com/personal/credit-report-services/credit-freeze/) | New credit (one of the three major bureaus). Keep your PIN or login to lift it later. |
| [Experian](https://www.experian.com/freeze/center.html) | New credit (major bureau). |
| [TransUnion](https://www.transunion.com/credit-freeze) | New credit (major bureau). |
| [ChexSystems](https://www.chexsystems.com/security-freeze/place-freeze) | New checking and savings accounts. |
| [NCTUE](https://www.nctue.com/consumers) | New phone, utility and pay-TV accounts. |
| [Innovis](https://www.innovis.com/personal/securityFreeze) | New credit (the "fourth" bureau, often missed). |
| [OptOutPrescreen](https://www.optoutprescreen.com/) | Prescreened credit and insurance offers in the mail. |

## Starting over or leaving

`node bin/upec-wipe.js clear` deletes your setup: `config.json` (or `config.json.enc`) and the passphrase file. Your history and logs stay, so you can run `setup` again, for example with a new mailbox, and the tool still knows what it already sent.

`node bin/upec-wipe.js clear-all` deletes everything the tool saved on this computer: the setup, `state.json` (your opt-out and email history and logged replies), `logs/` and the search history. After it, the next `run --email` would email every broker again.

Both list what they will delete and ask you to type `CLEAR` (or `CLEAR ALL`). Neither can delete your SimpleLogin alias (do that at simplelogin.io), emails already sent, your dedicated mailbox, what brokers already hold, or backups of this folder. Files are deleted normally, not overwritten.

## Command reference

Run each as `node bin/upec-wipe.js <command>`. "Sends" lists what leaves your computer; see [PRIVACY.md](PRIVACY.md) for details.

| Command | What it does | Sends |
| --- | --- | --- |
| `setup` | Asks for your details and writes `config.json`. | Nothing. |
| `doctor` | Checks your setup, including that SimpleLogin accepts your key. | After the network check passes: a connection to your SMTP host, one request to CapSolver, and one read-only request to SimpleLogin with your key (it creates no alias). |
| `preview` | Rehearses a run: opens every broker and fills the forms, submits nothing. Does not call CapSolver or open pages in your everyday browser. | Your name in each broker's search page. |
| `run` | The real opt-out pass: fills web forms (the same as `run --forms`). Never sends email. | Brokers: your name, city, state, zip and your alias. SimpleLogin: a request for your alias the first time. CapSolver: CAPTCHA pages, if you set a key. |
| `run --email` | Sends the email requests (see Email requests) after you type `SEND`. `preview --email` shows them and sends nothing. | Your dedicated mailbox's SMTP server, and each listed broker: your name, city and state, from the dedicated address. |
| `pending` | Lists brokers waiting for you to click a confirmation email. | Nothing. |
| `manual` | Lists the sites waiting for you to finish by hand, with the reason and link each run gave. Some links carry your name (a site's own search link). | Nothing. |
| `done` | Marks sites finished: `done "<name>" [...]`. Clears them from `manual` and `pending`; runs skip them for 90 days. | Nothing. |
| `reply` | Logs a broker's reply to an email request: `reply <broker> honored\|refused\|verify\|none\|bounced`. | Nothing. |
| `verify` | Searches the 5 brokers whose search it can read (Spokeo, WhitePages, FastPeopleSearch, MyLife, USPhonebook) again to see if you are still listed, and saves the result. | Your name in each broker's search page. |
| `list` | Lists the brokers, the catalog sites you can act on (reviewed or manual) and email requests with their last status; excluded and not-yet-reviewed sites are only counted. | Nothing. |
| `serp-watch` | Searches DuckDuckGo, Bing and Google for your name and lists sites where it is new since last time. | `"<your full name>" "<city>, <state>"` to those search engines. |
| `catalog-check` | Re-reads the opt-out pages of reviewed catalog sites and flags any that changed (those then run as manual until reviewed again). Read-only. | Nothing about you: it opens those pages through the Mullvad check. |
| `clear` | Deletes your setup (config and passphrase); keeps history. | Nothing. |
| `clear-all` | Deletes everything UPEC-WIPE saved on this computer. | Nothing. |

Useful options for `run` and `preview`: `--assist` (when a site shows a bot check such as Cloudflare's "Just a moment...", the run waits up to 3 minutes for you to complete it in the browser window, then fills and submits by itself; needs a visible window), `--only <broker>` and `--skip <broker>` (limit to or leave out brokers), `--resume` (carry on after an interrupted run), `--retry-failed` (only the brokers that failed last time) and `--no-capsolver` (treat CAPTCHA brokers as manual). `upec-wipe list` also lists the catalog sites you can act on, each with its status (`do by hand`, `awaiting confirm`, `success`...). `--allow <broker>` stops opting out of a broker you want to stay listed on, and `--unallow <broker>` undoes that.

## Troubleshooting

| Message | What to do |
| --- | --- |
| `Network check failed - nothing was submitted. ...` | Connect Mullvad and check https://am.i.mullvad.net says you are using it. Then run again. |
| `state.json could not be saved safely: another program is holding it ...` | Close the program that has the file open (an editor, a sync or backup tool, antivirus scanning it) and run again. Nothing was lost. |
| `Fatal: <message>` | Run the same command with `UPEC_WIPE_DEBUG=1` in front to also print where it failed (file and line only), and include that when you ask for help. |
| `Skipping person #N: Relay alias creation failed: ...` | Check the SimpleLogin API key in `config.json` and that your SimpleLogin account is verified. |
| `no usable relay is configured (provider "simplelogin" + apiKey) ...` | Add your SimpleLogin key as `apiKey` in the `relay` block. Without it nothing is submitted for you. Only `"required": false` sends your real email instead. |
| `... relay.apiKey is still the placeholder. ...` | Setup wrote `YOUR_SIMPLELOGIN_API_KEY` as a placeholder. Replace it with your SimpleLogin API key in the `relay` block. Until then nothing is submitted. |
| `Refusing to run as root. ...` | Do not use `sudo` or a root account for the tool. Use your own user (Part B). |
| `chmod has no effect on ... (mode came back ...)` | You are on `/mnt/c`. Move the install to your Linux home folder (Part A step 2). |
| `Passphrase file ... is readable by other users. Run: chmod 600 "..."` | Run the `chmod 600` command it prints. |
| `... - not sent: email.smtp.from ... Set email.smtp.from to a non-real address.` | Your `"from"` is missing or is your real email. Set it to a non-real address. |
| `... - not sent: email.smtp.user ... Use a separate SMTP mailbox that is not linked to you, or remove the email block ...` | Your SMTP login is your real email and brokers can see it. Switch to a separate mailbox not linked to you, or delete the `email` block and handle those brokers by hand. |
| `Email step not run: ...` | The email step checks its setup before sending anything. Fix what it names: the `email.smtp` block, `user` and `from` must be the same dedicated address, and it must run in a terminal so you can type `SEND`. |
| `Network check failed for direct connections - nothing was sent. ...` | The tool was about to contact SimpleLogin, CapSolver, your SMTP server or a registry, and Mullvad is off. Connect the Mullvad app and run again. |
| `Note: network.proxy covers the browser only. ...` | You set `network.proxy`. Brokers see the proxy, but those services see your real IP. Use the Mullvad app instead if that matters to you. |
| `Playwright is not installed. Run: npm ci --ignore-scripts && npx playwright install chromium` | Run that command in the tool's folder. |
| `blocked by bot protection - open in your normal browser: <link>` | The site blocks automated browsers or VPN addresses. Run again with `--assist` and complete the check in the browser window when asked. If the page says "you have been blocked" or "Error 1005", the site refuses this Mullvad server: switch servers or open the link yourself. |
| `... (check not completed in time) - open in your normal browser: <link>` | `--assist` waited 3 minutes and the check did not clear. Open the link yourself, or run that broker again with `--assist --only <broker>`. |
| `form not recognised (none of your details could be filled) - do it by hand: <link>` | The site changed its form, so nothing was submitted. Open the link and fill it in yourself. `node scripts/inspect-broker-forms.js <broker>` shows the current form so the definition can be updated. |
| `config.json is not valid JSON` (any command) | A hand edit broke `config.json`. Open it with `nano config.json` and look for a missing comma or quote near where you last edited. The message never shows the broken line, so your details stay out of logs. |
| `Warning: ... (serp-key) is damaged; replacing it. ...` | Harmless. Your search-scan history starts over once. |
| `ℹ  notify settings in config.json are ignored in this fork.` | Harmless. Notifications were removed, so you can delete the `notify` block. |

Before you rely on this, read [THREAT-MODEL.md](THREAT-MODEL.md) to see what it does and does not protect.
