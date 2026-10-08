#!/usr/bin/env bash
# scripts/harden.sh - make every file that can hold PII or secrets owner-only.
#
# Usage: bash scripts/harden.sh
# Exit: 0 ok, 1 run as root, 2 this filesystem ignores chmod (move the repo).
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
REPO="$(pwd)"

if [ "$(id -u)" = "0" ]; then
  echo "Do not run as root. Run as the unprivileged user that will run the tool." >&2
  exit 1
fi

mode_of() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

# Probe: does chmod work here? On WSL /mnt/<drive> (DrvFs without the metadata
# mount option), FAT and many SMB mounts it silently does nothing and every
# file stays readable by everyone.
probe="$(mktemp "$REPO/.harden-probe.XXXXXX")"
chmod 600 "$probe"
probe_mode="$(mode_of "$probe")"
rm -f "$probe"
if [ "$probe_mode" != "600" ]; then
  echo "chmod has no effect on $REPO (mode came back $probe_mode)." >&2
  case "$REPO" in
    /mnt/[a-z]/*) echo "This is a Windows drive under WSL. Move the repo into your Linux home, e.g.:" >&2
                  echo "  git clone \"$REPO\" ~/auto-identity-remove" >&2 ;;
    *)            echo "Move the repo to a local Linux/macOS filesystem." >&2 ;;
  esac
  exit 2
fi

PROFILE="${HOME}/.config/auto-identity-remove"
chmod 700 "$REPO"
for d in logs data "$PROFILE"; do
  [ -d "$d" ] && chmod 700 "$d"
done
for f in config.json config.json.enc state.json state.json.bak state.json.checkpoint \
         dashboard/.auth.json "$PROFILE/passphrase"; do
  [ -e "$f" ] && chmod 600 "$f"
done
find logs -type f -exec chmod 600 {} + 2>/dev/null || true

echo "Permissions hardened under $REPO (dirs 700, PII files 600)."
