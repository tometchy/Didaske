#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../app"
npm ci --no-audit --no-fund
case "${1-}" in
  --with-deps)
    ./node_modules/.bin/playwright install --with-deps chromium
    if command -v apt-get >/dev/null && [[ $(fc-match --format='%{family}' 'Noto Sans') != 'Noto Sans' ||
                                          $(fc-match --format='%{family}' 'DejaVu Serif') != 'DejaVu Serif' ]]; then
      elevate=()
      if [[ $EUID != 0 ]]; then elevate=(sudo); fi
      "${elevate[@]}" apt-get install -y --no-install-recommends fonts-noto-core fonts-dejavu-core
    fi
    ;;
  '') ./node_modules/.bin/playwright install chromium ;;
  *) echo 'Usage: scripts/setup-visual-tests.sh [--with-deps]' >&2; exit 2 ;;
esac
