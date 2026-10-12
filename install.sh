#!/usr/bin/env bash
# install.sh - one-command setup for upec-wipe.
#
# Run once after cloning:   bash install.sh
#
# Checks Node, installs dependencies, installs the Playwright Chromium browser,
# and prints what to do next. No personal data is touched here.

set -e

cd "$(dirname "$0")"

echo ""
echo "upec-wipe - installer"
echo "--------------------------------"

# 1. Node present?
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed."
  echo "Install Node 20 or newer from https://nodejs.org and re-run: bash install.sh"
  exit 1
fi

# 2. Node version >= 20 ?
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node.js 20 or newer is required (found $(node -v))."
  echo "Upgrade from https://nodejs.org and re-run: bash install.sh"
  exit 1
fi
echo "Node $(node -v) detected."

# 3. Install dependencies (reproducible - uses package-lock.json).
echo ""
echo "Installing dependencies (npm ci --ignore-scripts)..."
# --ignore-scripts: no dependency needs an install script, so none may run one.
npm ci --ignore-scripts

# 4. Install the Chromium browser Playwright drives.
echo ""
echo "Installing the Chromium browser (npx playwright install chromium)..."
npx playwright install chromium

# 5. Install the dashboard's own dependencies.
#    express lives in dashboard/package.json, not the root manifest, so without
#    this step `upec-wipe dashboard` fails with MODULE_NOT_FOUND right after a
#    documented install.
echo ""
echo "Installing dashboard dependencies..."
(cd dashboard && npm ci --ignore-scripts) || echo "  (dashboard deps failed - 'upec-wipe dashboard' will not start until you run: cd dashboard && npm ci --ignore-scripts)"

# 6. Next steps.
echo ""
echo "--------------------------------"
echo "Install complete."
echo ""
echo "Next steps:"
echo "  1. Run setup (creates config.json):"
echo "       node bin/upec-wipe.js setup"
echo "  2. Preview what it will do (submits nothing):"
echo "       node bin/upec-wipe.js preview"
echo "  3. Run for real when ready:"
echo "       node bin/upec-wipe.js run"
echo ""
echo "  Open the local web dashboard:"
echo "       node bin/upec-wipe.js dashboard"
echo ""
echo "Tip: run 'npm link' (or 'npm i -g .') to use 'upec-wipe' instead of 'node bin/upec-wipe.js'."
echo "--------------------------------"
echo ""
