#!/bin/bash
# apply-units.sh - bring the installed systemd units in line with systemd/ in the source tree.
# Called by scripts/update.sh. Only syncs units that are already installed (bootstrap.sh
# installs and enables them); never enables, starts, stops or restarts anything.
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

if [ "$changed" = 1 ]; then
  run $SUDO "$SYSTEMCTL" daemon-reload
else
  log "units: all installed units already match the repo"
fi
