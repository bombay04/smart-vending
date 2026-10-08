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

if ! [[ "$readiness_retry_seconds" =~ ^[1-9][0-9]*$ ]]; then
  echo "KIOSK_READY_RETRY_SECONDS must be a positive whole number." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to check whether the kiosk URL is ready." >&2
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

echo "Waiting for kiosk URL: $kiosk_url"
until curl --fail --silent --max-time 5 --output /dev/null "$kiosk_url"; do
  sleep "$readiness_retry_seconds"
done
echo "Kiosk URL is ready; starting Chromium."

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
