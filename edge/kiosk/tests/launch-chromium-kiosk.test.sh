#!/usr/bin/env bash
set -Eeuo pipefail

launcher="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/launch-chromium-kiosk.sh"
workspace_root="$(cd "$(dirname "$launcher")/../.." && pwd)"
test_root="$workspace_root/.tmp"
mkdir -p "$test_root"
test_dir="$(mktemp -d "$test_root/kiosk-launcher-test.XXXXXX")"
[[ "$test_dir" == "$test_root"/kiosk-launcher-test.* && -d "$test_dir" ]] || exit 1
trap 'if [[ "$test_dir" == "$test_root"/kiosk-launcher-test.* && -d "$test_dir" ]]; then rm -rf -- "$test_dir"; fi' EXIT
mkdir -p "$test_dir/bin" "$test_dir/home"

cat > "$test_dir/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "${@: -1}" >> "$TEST_DIR/curl.log"
IFS= read -r result < "$TEST_DIR/curl-results" || result=fail
tail -n +2 "$TEST_DIR/curl-results" > "$TEST_DIR/remaining"
mv "$TEST_DIR/remaining" "$TEST_DIR/curl-results"
[[ "$result" == pass ]]
STUB

cat > "$test_dir/bin/pgrep" <<'STUB'
#!/usr/bin/env bash
[[ -f "$TEST_DIR/chromium-running" ]]
STUB

cat > "$test_dir/bin/sleep" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$1" >> "$TEST_DIR/sleeps"
if [[ -f "$TEST_DIR/start-chromium-during-sleep" ]]; then
  touch "$TEST_DIR/chromium-running"
fi
STUB

cat > "$test_dir/bin/chromium" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$TEST_DIR/chromium-args"
STUB

chmod +x "$test_dir/bin/"*
export TEST_DIR="$test_dir"
export PATH="$test_dir/bin:$PATH"
export HOME="$test_dir/home"
export XDG_STATE_HOME="$test_dir/state"
export KIOSK_CONFIG_FILE="$test_dir/no-config"
export CHROMIUM_BIN="$test_dir/bin/chromium"
export KIOSK_READY_RETRY_SECONDS=2
export KIOSK_READY_MAX_ATTEMPTS=5
export KIOSK_URL=http://localhost:5173

reset_case() {
  rm -f "$test_dir/curl.log" "$test_dir/sleeps" "$test_dir/chromium-args" \
    "$test_dir/chromium-running" "$test_dir/start-chromium-during-sleep"
  : > "$test_dir/curl-results"
}

run_launcher() {
  if bash "$launcher" > "$test_dir/output" 2>&1; then
    status=0
  else
    status=$?
  fi
}

fail() {
  echo "FAIL: $1" >&2
  cat "$test_dir/output" >&2
  exit 1
}

reset_case
printf 'pass\nfail\npass\npass\npass\npass\n' > "$test_dir/curl-results"
run_launcher
[[ "$status" == 0 && -f "$test_dir/chromium-args" ]] || fail "transient module failure must wait for stability"
[[ "$(wc -l < "$test_dir/curl.log")" == 6 ]] || fail "root and module must pass twice after failure"
[[ "$(wc -l < "$test_dir/sleeps")" == 2 ]] || fail "readiness checks need retry intervals"
grep -Fx -- 'http://localhost:5173/src/main.tsx' "$test_dir/curl.log" >/dev/null || fail "local Vite module was not checked"
grep -Fx -- '--kiosk' "$test_dir/chromium-args" >/dev/null || fail "kiosk flag changed"
grep -Fx -- '--app=http://localhost:5173' "$test_dir/chromium-args" >/dev/null || fail "application URL changed"
grep -Fx -- "--user-data-dir=$test_dir/state/smart-vending-kiosk/chromium" "$test_dir/chromium-args" >/dev/null || fail "browser profile changed"

reset_case
touch "$test_dir/chromium-running"
run_launcher
[[ "$status" == 0 && ! -f "$test_dir/chromium-args" && ! -f "$test_dir/curl.log" ]] || fail "existing Chromium must not be touched"

reset_case
printf 'fail\n' > "$test_dir/curl-results"
touch "$test_dir/start-chromium-during-sleep"
run_launcher
[[ "$status" == 0 && ! -f "$test_dir/chromium-args" ]] || fail "Chromium started during wait must not be duplicated"

reset_case
export KIOSK_READY_MAX_ATTEMPTS=3
printf 'fail\nfail\nfail\n' > "$test_dir/curl-results"
run_launcher
[[ "$status" == 1 && ! -f "$test_dir/chromium-args" ]] || fail "timeout must not launch Chromium"
[[ "$(wc -l < "$test_dir/sleeps")" == 2 ]] || fail "timeout wait must be bounded"
grep -F 'did not become stable' "$test_dir/output" >/dev/null || fail "timeout needs a diagnostic"

reset_case
export KIOSK_URL=https://example.test/kiosk
printf 'pass\npass\n' > "$test_dir/curl-results"
run_launcher
[[ "$status" == 0 && -f "$test_dir/chromium-args" ]] || fail "configured remote URL must remain supported"
[[ "$(wc -l < "$test_dir/curl.log")" == 2 ]] || fail "remote URL should not probe a local Vite module"

echo "PASS: five cold-start launcher scenarios"
