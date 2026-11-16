#!/bin/bash
# apply-boot.sh - make sure the kernel command line has the settings in config/kernel-cmdline.txt.
# Called by scripts/update.sh. Adds a missing setting, replaces a setting with the same key and
# another value, never removes anything else. Backs the file up before a change and checks the
# result is still one line with root=. Takes effect at the next reboot (update.sh never reboots).
# Env: SRC (tree to apply, required), DRY_RUN, UPDATE_CHANGED; CMDLINE (default
# /boot/firmware/cmdline.txt) can be overridden for testing.
set -euo pipefail
SRC="${SRC:?SRC (the source tree to apply) is required}"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
CMDLINE="${CMDLINE:-/boot/firmware/cmdline.txt}"
LIST="$SRC/config/kernel-cmdline.txt"

[ -f "$LIST" ] || { log "kernel cmdline: no config/kernel-cmdline.txt, nothing to do"; exit 0; }
[ -f "$CMDLINE" ] || { log "kernel cmdline: $CMDLINE not found, skipped"; exit 0; }

key_of() { # video=HDMI-A-1:mode -> video=HDMI-A-1 ; name=value -> name ; flag -> flag
  case "$1" in video=*:*) echo "${1%%:*}" ;; *=*) echo "${1%%=*}" ;; *) echo "$1" ;; esac
}

current="$(head -n1 "$CMDLINE")"
new="$current"
while IFS= read -r line || [ -n "$line" ]; do
  tok="${line%%#*}"; tok="$(echo "$tok" | tr -d '[:space:]')"
  [ -z "$tok" ] && continue
  key="$(key_of "$tok")"
  kept=""; found=0
  for t in $new; do
    if [ "$(key_of "$t")" = "$key" ]; then
      found=1
      [ "$t" = "$tok" ] && kept="$kept $t"   # same value: keep; other value: dropped and re-added below
    else
      kept="$kept $t"
    fi
  done
  kept="${kept# }"
  if ! printf '%s\n' "$kept" | tr ' ' '\n' | grep -qxF -- "$tok"; then
    [ "$found" = 1 ] && log "kernel cmdline: replacing the value of $key with $tok" || log "kernel cmdline: adding $tok"
    kept="$kept $tok"
  else
    log "kernel cmdline: $tok already present"
  fi
  new="$kept"
done < "$LIST"

if [ "$new" = "$current" ]; then exit 0; fi
case "$new" in *root=*) ;; *) die "kernel cmdline: result has no root=, not written" ;; esac
log "kernel cmdline: new line: $new"
if [ "$DRY_RUN" = 1 ]; then
  log "  [dry-run] would back up $CMDLINE and write the new line"
else
  backup="$CMDLINE.bak-pi-photo-hub-$(date +%Y%m%d-%H%M%S)"
  $SUDO cp -p "$CMDLINE" "$backup"
  printf '%s\n' "$new" | $SUDO tee "$CMDLINE.new" >/dev/null
  [ "$($SUDO wc -l < "$CMDLINE.new")" = 1 ] || die "kernel cmdline: new file is not one line; $CMDLINE unchanged"
  $SUDO mv "$CMDLINE.new" "$CMDLINE"
  log "kernel cmdline: written (backup $backup); takes effect at the next reboot"
fi
note_changed "boot-cmdline"
