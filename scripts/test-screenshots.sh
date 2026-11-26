#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
if [[ $(uname -s) == Linux ]]; then
  export FONTCONFIG_FILE="$root/tests/visual/fonts.conf"
  for font in 'Noto Sans' 'DejaVu Serif'; do
    [[ $(fc-match --format='%{family}' "$font") == "$font" ]] || {
      echo "Screenshot typeface missing: $font. Run bash scripts/setup-visual-tests.sh --with-deps." >&2
      exit 1
    }
  done
fi
# Always rebuild the reviewed checkout. Bind a fresh port and clean up on exit.
python3 data/build/snapshot.py
npm --prefix app run build
run_dir=$(mktemp -d)
python3 scripts/serve-preview.py "$run_dir/port" >"$run_dir/http.log" 2>&1 &
server_pid=$!
cleanup() {
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  rm -rf -- "$run_dir"
}
trap cleanup EXIT
for (( attempt=0; attempt<100; attempt++ )); do
  [[ -s "$run_dir/port" ]] && break
  kill -0 "$server_pid" || { cat "$run_dir/http.log"; exit 1; }
  sleep 0.1
done
export DIDASKE_TEST_URL="http://127.0.0.1:$(cat "$run_dir/port")"
curl --fail --silent "$DIDASKE_TEST_URL/pl/Tag/" | grep -F 'narodzenie-jezusa' >/dev/null
cd app
./node_modules/.bin/codeceptjs run --config "$root/tests/codecept.conf.cjs"
./node_modules/.bin/playwright test --config "$root/tests/visual/playwright.config.cjs" "$@"
