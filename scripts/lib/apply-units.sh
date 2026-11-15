#!/bin/bash
# apply-units.sh - bring the installed systemd units, and Picapport's init script, in line with
# systemd/ and initd/ in the source tree. Called by scripts/update.sh. Only syncs files that are
# already installed (bootstrap.sh installs and enables them); never enables, starts, stops or restarts anything.
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
LIST

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
