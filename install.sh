#!/bin/bash
# Houston Kart Sim installer for macOS: downloads the latest release and puts the app in Applications.
set -euo pipefail
REPO="4d1t-Codezz/houston-kart-sim"
ARCH=$(uname -m); [ "$ARCH" = "arm64" ] || ARCH="x64"
URL="https://github.com/$REPO/releases/latest/download/Houston-Kart-Sim-mac-$ARCH.zip"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "Downloading Houston Kart Sim for $ARCH Mac..."
curl -fL --progress-bar "$URL" -o "$TMP/hks.zip"
DEST="/Applications"; [ -w "$DEST" ] || DEST="$HOME/Applications"; mkdir -p "$DEST"
rm -rf "$DEST/Houston Kart Sim.app"
ditto -x -k "$TMP/hks.zip" "$DEST"
xattr -cr "$DEST/Houston Kart Sim.app" 2>/dev/null || true
echo "Installed: $DEST/Houston Kart Sim.app"
open "$DEST/Houston Kart Sim.app"
