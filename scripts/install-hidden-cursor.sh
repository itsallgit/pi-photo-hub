#!/bin/bash
# install-hidden-cursor.sh - hide the mouse pointer on the slideshow screen (owner, 2026-11-16).
# Installs a blank pointer theme for user pi (every pointer name is a transparent 1x1 image) and
# makes the desktop use it. Chromium gets the same theme from the photo API (CURSOR_THEME in
# api/lib/config.js), so the pointer is hidden from the next slideshow launch; the desktop's own
# pointer is hidden from the next login/reboot. Safe to run repeatedly. Run as user pi.
#   bash scripts/install-hidden-cursor.sh            install / refresh
#   bash scripts/install-hidden-cursor.sh --remove   show the normal pointer again (after a reboot)
set -euo pipefail
THEME="pi-photo-hub-blank"
DIR="${CURSOR_ICONS_DIR:-$HOME/.icons}/$THEME"
LABWC_ENV="${LABWC_ENV:-$HOME/.config/labwc/environment}"
NAMES_FROM="${CURSOR_NAMES_FROM:-/usr/share/icons/PiXflat/cursors}"
TAG="# pi-photo-hub: hidden pointer"

remove_env_line() {
  [ -f "$LABWC_ENV" ] || return 0
  grep -v -e "^$TAG$" -e "^XCURSOR_THEME=$THEME$" "$LABWC_ENV" > "$LABWC_ENV.tmp" || true
  mv "$LABWC_ENV.tmp" "$LABWC_ENV"
}

if [ "${1:-}" = "--remove" ]; then
  remove_env_line
  rm -rf "$DIR"
  echo "[INFO] Hidden pointer removed; the normal pointer returns after a reboot (Chromium: at its next launch)."
  exit 0
fi

mkdir -p "$DIR/cursors"
printf '[Icon Theme]\nName=%s\nComment=Transparent pointer for the Pi Photo Hub slideshow\n' "$THEME" > "$DIR/index.theme"
# One Xcursor file with a single transparent 1x1 image (format: Xcursor(3), little-endian).
python3 - "$DIR/cursors/left_ptr" <<'PY'
import struct, sys
img = struct.pack("<9I", 36, 0xfffd0002, 24, 1, 1, 1, 0, 0, 0) + struct.pack("<I", 0)
data = b"Xcur" + struct.pack("<3I", 16, 0x10000, 1) + struct.pack("<3I", 0xfffd0002, 24, 28) + img
open(sys.argv[1], "wb").write(data)
PY
# Every pointer name the desktop's normal theme has, plus common ones, points at the blank image.
names="$( (ls "$NAMES_FROM" 2>/dev/null; printf '%s\n' default arrow top_left_arrow pointer hand1 hand2 text xterm wait watch progress left_ptr_watch crosshair move grab grabbing not-allowed) | sort -u)"
for n in $names; do
  [ "$n" = left_ptr ] || ln -sfn left_ptr "$DIR/cursors/$n"
done
# The desktop (labwc) reads this file at login.
mkdir -p "$(dirname "$LABWC_ENV")"
touch "$LABWC_ENV"
remove_env_line
grep -v '^XCURSOR_THEME=' "$LABWC_ENV" > "$LABWC_ENV.tmp" || true
mv "$LABWC_ENV.tmp" "$LABWC_ENV"
{ echo "$TAG"; echo "XCURSOR_THEME=$THEME"; } >> "$LABWC_ENV"
echo "[INFO] Hidden pointer installed ($DIR, $(ls "$DIR/cursors" | wc -l) names); desktop: from the next reboot; slideshow: from its next launch."
