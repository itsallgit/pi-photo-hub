#!/bin/bash
# apply-units.sh - bring the installed systemd units, and Picapport's init script, in line with
# systemd/ and initd/ in the source tree. Called by scripts/update.sh. Only syncs files that are
# already installed (bootstrap.sh installs and enables them); never starts, stops or restarts anything.
# Exception: units added to the project later (NEW_UNITS below, for example photo-buttons.service of the
# slideshow layer) are installed and enabled here when missing, so an update brings them as a fresh
# build would; update.sh then starts them with the app.
#   SRC=<tree> [DRY_RUN=1] bash scripts/lib/apply-units.sh
set -euo pipefail
SRC="${SRC:?SRC (the source tree to apply) is required}"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

changed=0
while read -r rel name; do
  src="$SRC/$rel"; dst="$UNIT_DIR/$name"
  if [ ! -f "$src" ]; then log "unit $name: $rel not in the source tree, skipped"; continue; fi
  if [ ! -f "$dst" ]; then
    log "unit $name: not installed on this machine, skipped (bootstrap.sh installs units)"
    continue
  fi
  if sync_file "$src" "$dst" "unit $name"; then
    changed=1
    note_changed "unit:$name"
  fi
done <<'LIST'
systemd/mount-hdd.service mount-hdd.service
systemd/photo-api.service.template photo-api.service
systemd/picapport-chromium.service.template picapport-chromium.service
systemd/picapport-wrapper.service picapport-wrapper.service
systemd/photo-buttons.service photo-buttons.service
LIST

# Units added to the project after the first builds: installed and enabled when missing.
NEW_UNITS="photo-buttons.service"
for name in $NEW_UNITS; do
  src="$SRC/systemd/$name"; dst="$UNIT_DIR/$name"
  [ -f "$src" ] || continue
  if [ ! -f "$dst" ]; then
    log "unit $name: new in the project, installing and enabling it"
    run $SUDO install -m 644 "$src" "$dst"
    run $SUDO "$SYSTEMCTL" daemon-reload
    run $SUDO "$SYSTEMCTL" enable "$name"
    note_changed "unit:$name"
    changed=1
  fi
done

# Picapport's init script (used by picapport-wrapper.service for start and stop). Synced like a
# unit: only if installed; takes effect at the next Picapport stop/start, which this never does.
INITD_DIR="${INITD_DIR:-/etc/init.d}"
if [ -f "$SRC/initd/picapport" ]; then
  if [ -f "$INITD_DIR/picapport" ]; then
    if MODE=755 sync_file "$SRC/initd/picapport" "$INITD_DIR/picapport" "init script picapport"; then
      note_changed "initd:picapport"
    fi
  else
    log "init script picapport: not installed on this machine, skipped (bootstrap.sh installs it)"
  fi
fi

if [ "$changed" = 1 ]; then
  run $SUDO "$SYSTEMCTL" daemon-reload
else
  log "units: all installed units already match the repo"
fi
