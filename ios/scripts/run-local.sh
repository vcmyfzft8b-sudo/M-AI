#!/bin/bash
#
# Build the app and run it against a local web server, so iOS work does not have to wait for a
# web change to reach production.
#
#   ios/scripts/run-local.sh                 # against http://localhost:3000
#   ios/scripts/run-local.sh 3001            # a different port
#   ios/scripts/run-local.sh https://x.vercel.app   # a branch preview
#
# Start the web server yourself first (`npm run dev` in the repo root). This only builds,
# installs and launches the app pointed at it.
set -euo pipefail

TARGET="${1:-3000}"
DEVICE="${MEMO_SIM_DEVICE:-iPhone 17}"

# A bare number is a localhost port; anything else is used as-is.
if [[ "$TARGET" =~ ^[0-9]+$ ]]; then
  BASE_URL="http://localhost:${TARGET}"
else
  BASE_URL="$TARGET"
fi

IOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED="${IOS_DIR}/build/run-local"
BUNDLE_ID="eu.memoai.app"

echo "▸ server   ${BASE_URL}"
echo "▸ device   ${DEVICE}"

if [[ "$BASE_URL" == http://localhost:* || "$BASE_URL" == http://127.0.0.1:* ]]; then
  PORT="${BASE_URL##*:}"
  if ! curl -fsS -o /dev/null --max-time 3 "$BASE_URL"; then
    echo "✗ nothing answering on ${BASE_URL} — start the web server first (npm run dev)" >&2
    exit 1
  fi
  # The simulator shares the Mac's network stack, so localhost is the Mac. A physical device
  # does not, and needs this address instead.
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
  [[ -n "$LAN_IP" ]] && echo "▸ for a physical device, use http://${LAN_IP}:${PORT}"
fi

echo "▸ booting simulator"
xcrun simctl boot "$DEVICE" 2>/dev/null || true
open -a Simulator
xcrun simctl bootstatus "$DEVICE" -b >/dev/null

echo "▸ building"
xcodebuild build \
  -project "${IOS_DIR}/MemoWeb.xcodeproj" \
  -scheme MemoWeb \
  -configuration Debug \
  -destination "platform=iOS Simulator,name=${DEVICE}" \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO \
  -quiet

APP="${DERIVED}/Build/Products/Debug-iphonesimulator/MemoWeb.app"

echo "▸ installing"
xcrun simctl install "$DEVICE" "$APP"

# The launch argument pins the environment for this run and outranks any stored choice, so a
# scripted run always lands where you asked.
echo "▸ launching"
xcrun simctl launch --console-pty "$DEVICE" "$BUNDLE_ID" -MemoBaseURL "$BASE_URL" &
LAUNCH_PID=$!

cat <<EOF

Running against ${BASE_URL}.

  · Shake (⌃⌘Z in the Simulator) to switch servers from inside the app.
  · Safari ▸ Develop ▸ Simulator inspects the page.
  · Ctrl-C detaches the log; the app keeps running.
EOF

wait "$LAUNCH_PID"
