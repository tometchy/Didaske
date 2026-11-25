#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../app"
npm ci --no-audit --no-fund
case "${1-}" in
  --with-deps) ./node_modules/.bin/playwright install --with-deps chromium ;;
  '') ./node_modules/.bin/playwright install chromium ;;
  *) echo 'Usage: scripts/setup-visual-tests.sh [--with-deps]' >&2; exit 2 ;;
esac
