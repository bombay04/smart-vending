#!/usr/bin/env bash
set -Eeuo pipefail

config_file="${KIOSK_CONFIG_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/smart-vending-kiosk.env}"
if [[ -r "$config_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$config_file"
  set +a
fi

kiosk_url="${KIOSK_URL:-http://localhost:5173}"
chromium_binary="${CHROMIUM_BIN:-}"
readiness_retry_seconds="${KIOSK_READY_RETRY_SECONDS:-2}"
readiness_max_attempts="${KIOSK_READY_MAX_ATTEMPTS:-30}"

if ! [[ "$readiness_retry_seconds" =~ ^[1-9][0-9]*$ ]]; then
  echo "KIOSK_READY_RETRY_SECONDS must be a positive whole number." >&2
  exit 1
fi
if ! [[ "$readiness_max_attempts" =~ ^[1-9][0-9]*$ ]] || ((readiness_max_attempts < 2)); then
  echo "KIOSK_READY_MAX_ATTEMPTS must be a whole number of at least 2." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to check whether the kiosk URL is ready." >&2
  exit 1
fi
if ! command -v pgrep >/dev/null 2>&1; then
  echo "pgrep is required to avoid launching a second Chromium instance." >&2
  exit 1
fi

if [[ -z "$chromium_binary" ]]; then
  for candidate in chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      chromium_binary="$(command -v "$candidate")"
      break
    fi
  done
fi

if [[ -z "$chromium_binary" || ! -x "$chromium_binary" ]]; then
  echo "Chromium was not found. Install it or set CHROMIUM_BIN." >&2
  exit 1
fi

state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/smart-vending-kiosk"
mkdir -p "$state_dir/chromium"

chromium_running() {
  pgrep -u "$(id -u)" -f '(^|/)(chromium|chromium-browser)([[:space:]]|$)' >/dev/null
}

if chromium_running; then
  echo "Chromium is already running; leaving the current session untouched."
  exit 0
fi

readiness_asset_url=""
if [[ "$kiosk_url" =~ ^(https?://(localhost|127\.0\.0\.1):5173)(/|$) ]]; then
  readiness_asset_url="${BASH_REMATCH[1]}/src/main.tsx"
fi

echo "Waiting for stable kiosk readiness at $kiosk_url (up to $readiness_max_attempts checks)."
consecutive_ready=0
for ((attempt = 1; attempt <= readiness_max_attempts; attempt++)); do
  if chromium_running; then
    echo "Chromium started while waiting; leaving the current session untouched."
    exit 0
  fi

  if curl --fail --silent --max-time 2 --output /dev/null "$kiosk_url" && \
     { [[ -z "$readiness_asset_url" ]] || curl --fail --silent --max-time 2 --output /dev/null "$readiness_asset_url"; }; then
    ((consecutive_ready += 1))
    echo "Kiosk readiness check $attempt/$readiness_max_attempts passed ($consecutive_ready/2 consecutive)."
    if ((consecutive_ready == 2)); then
      break
    fi
  else
    consecutive_ready=0
    echo "Kiosk readiness check $attempt/$readiness_max_attempts failed."
  fi

  if ((attempt < readiness_max_attempts)); then
    sleep "$readiness_retry_seconds"
  fi
done

if ((consecutive_ready < 2)); then
  echo "Kiosk frontend did not become stable; Chromium was not launched." >&2
  exit 1
fi

if chromium_running; then
  echo "Chromium started before launch; leaving the current session untouched."
  exit 0
fi
echo "Kiosk frontend is stable; starting Chromium."

exec "$chromium_binary" \
  --kiosk \
  --app="$kiosk_url" \
  --start-fullscreen \
  --no-first-run \
  --no-default-browser-check \
  --password-store=basic \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --overscroll-history-navigation=0 \
  --disable-pinch \
  --user-data-dir="$state_dir/chromium"
