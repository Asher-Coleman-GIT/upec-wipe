# UPEC guide to auto-identity-remove

## What this does

Data brokers are companies that collect and sell your name, address and phone number. This tool visits hundreds of them each month and files the opt-out forms for you. It is set up here so that brokers only ever see a throwaway email address and a VPN address, never your real ones.

## What you need before starting

- A Mullvad account (mullvad.net). You can pay without giving an email address.
- A SimpleLogin account (simplelogin.io) with an API key.
- About 1 hour.

Commands go in a terminal, which is a window where you type instructions. Type each command exactly, then press Enter. To paste into most terminals, right-click. Every command below sits in its own box, with a sentence before it saying what it does and a sentence after it saying what you should see.

## Before you start: Mullvad

1. Install the Mullvad app from mullvad.net/download, log in, and click Connect.
2. Open Settings, then VPN settings, and turn on **Lockdown mode**. This blocks all internet access if the VPN drops, so nothing leaks mid-run.
3. Open https://am.i.mullvad.net in a browser. It should say "You are using Mullvad".

## Before you start: SimpleLogin

1. Create an account at simplelogin.io and verify your email.
2. Go to Settings, then API Keys, then Create, and copy the key somewhere safe (a password manager is best).

Why: each broker gets a throwaway address that forwards to you, so they never learn your real one.

## Part A: Windows (WSL2)

WSL2 gives Windows a built-in Linux. This tool runs inside it.

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

1. Optional, only if you want encryption: create an empty passphrase file that only you can read. Do this before setup, because setup only wires the passphrase file into the monthly job if it already exists. Skip to step 2 if you do not want encryption:

   ```
   mkdir -p ~/.config/auto-identity-remove && install -m 600 /dev/null ~/.config/auto-identity-remove/passphrase
   ```

   Open it with `nano ~/.config/auto-identity-remove/passphrase`, type a long passphrase (a few random words), and save. Warning: if you lose the passphrase, your config cannot be recovered and you must run setup again.

2. Run the setup questions. This asks for your name, address and other details, and saves them in `config.json` in this folder:

   ```
   node bin/aidr.js setup
   ```

   Answer each question and press Enter. When it asks "Encrypt config.json now?", answer **n**: encryption comes last, after you have edited the file. When it asks about scheduling, say yes. That installs the monthly job, and if the passphrase file from step 1 exists, the monthly systemd job is given access to it. The tool also looks for the passphrase in `~/.config/auto-identity-remove/passphrase` on its own, so the cron and launchd fallbacks and your manual commands find it there too.

3. Open the settings file in a simple editor:

   ```
   nano config.json
   ```

   Move with the arrow keys. To save, press Ctrl+O then Enter. To leave, press Ctrl+X. Set these three things exactly.

   The relay (your SimpleLogin key). `"required": true` means the tool refuses to run without a working alias:

   ```
   "relay": { "provider": "simplelogin", "apiKey": "<your key>", "required": true }
   ```

   The email block, used for brokers that only accept an email. **Recommended: delete the whole `email` block** and handle email-only brokers by hand. The tool lists them as manual. The reason: a broker that receives your email can see the address of the SMTP account it was sent from, whatever `"from"` says. Gmail, for example, replaces `"from"` with your Gmail address, and the account address also travels in the hidden envelope. So only keep this block if you have a separate mailbox that is not linked to you in any way, and use that mailbox for both `"user"` and `"from"`. Never use your everyday email account here. The tool refuses to send if `"user"` or `"from"` is your real email:

   ```
   "email": { "smtp": { "host": "...", "port": 587, "user": "<separate mailbox not linked to you>", "pass": "...", "from": "<the same separate mailbox>" } }
   ```

   The network check. `"required": true` makes the tool stop unless Mullvad is on. Leave `proxy` empty if you use the Mullvad app:

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

   It prints a list of checks. Fix anything marked as a problem before you continue.

7. Rehearse a run with `aidr preview` (you run it as `node bin/aidr.js preview`). Make sure Mullvad is connected first. It does everything except submit:

   ```
   node bin/aidr.js preview
   ```

   Nothing is submitted. Expect a line with `🛡  Network: Mullvad exit`. Now do the real run:

   ```
   node bin/aidr.js run
   ```

   It works through the brokers for a while and prints a summary at the end.

## Part C: Docker

Docker runs the tool in a sealed box. Only use this if the club maintainer told you to. The Docker setup in this repository is still pending verification on a real Docker host, so expect to report problems.

1. Install Docker Desktop (on Windows, enable the WSL2 backend), or on Linux install `docker.io`. Keep Mullvad connected on the host computer.
2. Clone into your home folder as in Part A step 4, then copy the example config:

   ```
   cp config.example.json config.json
   ```

   Edit it with `nano config.json` as in Configure step 3.

3. Create the files Docker mounts. This makes an empty state file, a logs folder, a private secrets folder and an empty passphrase file only you can read:

   ```
   touch state.json && mkdir -p logs && mkdir -m 700 secrets && install -m 600 /dev/null secrets/aidr-passphrase
   ```

   If you do not encrypt your config, remove the `secrets` lines from `docker-compose.yml`. If you do, the passphrase file must be readable by the container user (uid 1001): run `sudo chown 1001 secrets/aidr-passphrase`, then type your passphrase into it with `sudo nano secrets/aidr-passphrase`.

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
2. Run the tool (the scheduled job from setup does this automatically on the 1st, but you can also run it yourself):

   ```
   node bin/aidr.js run
   ```

   With Docker, use `docker compose run --rm watcher` instead.

   On WSL2 the scheduled job only runs if Ubuntu is running with systemd enabled and Mullvad is connected on Windows. Otherwise run it by hand.

3. Check your SimpleLogin inbox for "confirm your request" emails and click each link. The scheduled job cannot do this part, so you must.
4. See which brokers still need you:

   ```
   node bin/aidr.js pending
   ```

   It lists opt-outs waiting for a confirmation or a manual step.

## Dashboard (optional)

A web page for browsing results. It only works on this computer.

```
node bin/aidr.js dashboard
```

It prints a web address and a login. Open the address in your browser and use that login.

## Troubleshooting

| Message | What to do |
| --- | --- |
| `⛔ Network check failed - nothing was submitted. ...` | Connect Mullvad and check https://am.i.mullvad.net says you are using it. Then run again. |
| `⛔ Skipping person #N: Relay alias creation failed: ...` | Check the SimpleLogin API key in `config.json` and that your SimpleLogin account is verified. |
| `config.relay.required is true but no usable relay is configured (provider "simplelogin" + apiKey)` | Add your SimpleLogin key as `apiKey` in the `relay` block. |
| `Refusing to run as root. ...` | Do not use `sudo` or a root account for the tool. Use your own user (Part B). |
| `chmod has no effect on ... (mode came back ...)` | You are on `/mnt/c`. Move the install to your Linux home folder (Part A step 2). |
| `Passphrase file ... is readable by other users. Run: chmod 600 "..."` | Run the `chmod 600` command it prints. |
| `... - not sent: ... Set email.smtp.from to a non-real address.` | Your SMTP account or `"from"` is your real email. Delete the `email` block and handle that broker by hand, or switch to a separate mailbox not linked to you. |
| `aidr-dashboard: AIDR_HOST=... is not a loopback address. ...` | Unset `AIDR_HOST` so the dashboard stays on this computer. |
| `ℹ  notify settings in config.json are ignored in this fork.` | Harmless. Notifications were removed, so you can delete the `notify` block. |

Before you rely on this, read [THREAT-MODEL.md](THREAT-MODEL.md) to see what it does and does not protect.
