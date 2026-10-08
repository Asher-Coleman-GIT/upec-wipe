#!/bin/bash
# auto-identity-remove - manual trigger and scheduler entrypoint
# Usage: ./run.sh [watcher.js flags]

set -e
umask 077
cd "$(dirname "$0")"

if [ "$(id -u)" = "0" ]; then
  echo "Refusing to run as root. Use a dedicated unprivileged user or Docker." >&2
  exit 1
fi

if [ ! -f config.json ] && [ ! -f config.json.enc ]; then
  echo "config.json not found. Run: node setup.js" >&2
  exit 1
fi

# Platform-aware Playwright browsers path
if [ -z "${PLAYWRIGHT_BROWSERS_PATH}" ]; then
  if [ "$(uname -s)" = "Darwin" ]; then
    export PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright"
  else
    export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
  fi
fi

node watcher.js "$@"
