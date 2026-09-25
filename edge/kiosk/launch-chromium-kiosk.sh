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
