#!/bin/bash
# install-hidden-cursor.sh - hide the mouse pointer on the slideshow screen (owner, 2026-11-16).
# Installs a blank pointer theme for user pi (every pointer name is a transparent 1x1 image) and
# makes the desktop use it. Chromium gets the same theme from the photo API (CURSOR_THEME in
# api/lib/config.js) and the GTK pointer setting (which Chromium actually uses), so the pointer is
# hidden from the next slideshow launch; the desktop's own
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

# Chromium (and other GTK apps) take the pointer theme from the GTK setting, which overrides
# XCURSOR_THEME: seen 2026-11-17, the PiXflat black hand stayed visible. So set it there too.
GTK_INI="${GTK_INI:-$HOME/.config/gtk-3.0/settings.ini}"
DEFAULT_THEME_DIR="$(dirname "$DIR")/default"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"

gtk_ini_set() { # $1 = theme name, or empty to remove the line
  mkdir -p "$(dirname "$GTK_INI")"
  [ -f "$GTK_INI" ] || printf '[Settings]\n' > "$GTK_INI"
  grep -v '^gtk-cursor-theme-name=' "$GTK_INI" > "$GTK_INI.tmp" || true
  mv "$GTK_INI.tmp" "$GTK_INI"
  grep -q '^\[Settings\]' "$GTK_INI" || printf '[Settings]\n' >> "$GTK_INI"
  if [ -n "$1" ]; then sed -i "/^\[Settings\]/a gtk-cursor-theme-name=$1" "$GTK_INI"; fi
}

gsettings_set() { # $1 = theme name, or empty to reset to the system default
  command -v gsettings >/dev/null 2>&1 || return 0
  [ -S "${DBUS_SESSION_BUS_ADDRESS#unix:path=}" ] || { echo "[WARN] no desktop session bus: GTK pointer setting not changed (re-run after login)"; return 0; }
  if [ -n "$1" ]; then gsettings set org.gnome.desktop.interface cursor-theme "$1"
  else gsettings reset org.gnome.desktop.interface cursor-theme; fi
}

if [ "${1:-}" = "--remove" ]; then
  remove_env_line
  gtk_ini_set ""
  gsettings_set ""
  if grep -q "pi-photo-hub" "$DEFAULT_THEME_DIR/index.theme" 2>/dev/null; then rm -rf "$DEFAULT_THEME_DIR"; fi
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
# The GTK pointer setting (Chromium reads it) and the user's default pointer theme.
gtk_ini_set "$THEME"
gsettings_set "$THEME"
if [ ! -e "$DEFAULT_THEME_DIR" ] || grep -q "pi-photo-hub" "$DEFAULT_THEME_DIR/index.theme" 2>/dev/null; then
  mkdir -p "$DEFAULT_THEME_DIR"
  printf '[Icon Theme]\nName=default\nComment=pi-photo-hub: hidden pointer\nInherits=%s\n' "$THEME" > "$DEFAULT_THEME_DIR/index.theme"
fi
echo "[INFO] Hidden pointer installed ($DIR, $(ls "$DIR/cursors" | wc -l) names); desktop: from the next reboot; slideshow: from its next launch."
