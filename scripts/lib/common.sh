#!/bin/bash
# common.sh - helpers shared by scripts/lib/apply-*.sh. Source it; do not run it.
#
# Every path and command below can be overridden by an environment variable. That is
# for testing the script logic away from the Pi (see docs/architecture.md, "Updating");
# on the Pi the defaults are right.

DRY_RUN="${DRY_RUN:-0}"
STATE_DIR="${STATE_DIR:-/var/lib/photo-api}"
LOG_DIR="${LOG_DIR:-/var/log/pi-photo-hub}"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"
LOGROTATE_DIR="${LOGROTATE_DIR:-/etc/logrotate.d}"
PICAPPORT_PROPS_DST="${PICAPPORT_PROPS_DST:-/opt/picapport/.picapport/picapport.properties}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
OWNER="${OWNER:-pi}"
if [ -z "${SUDO+x}" ]; then
  if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
fi
export OWNER_ARGS   # "-o pi -g pi" for install(1), only where that user exists (used by apply-extras.sh)
if id "$OWNER" >/dev/null 2>&1; then OWNER_ARGS="-o $OWNER -g $OWNER"; else OWNER_ARGS=""; fi

log() {
  local m
  m="[$(date '+%F %T')] $*"
  echo "$m"
  if [ "$DRY_RUN" != 1 ]; then
    $SUDO mkdir -p "$LOG_DIR" 2>/dev/null || true
    printf '%s\n' "$m" | $SUDO tee -a "$LOG_DIR/update.log" >/dev/null 2>&1 || true
  fi
}

die() { log "[ERROR] $*"; exit 1; }

# run <command...>: execute it, or in dry-run mode only say what would be run.
run() {
  if [ "$DRY_RUN" = 1 ]; then log "  [dry-run] would run: $*"; else "$@"; fi
}

# note_changed <tag>: record a change for update.sh (it decides restarts from these).
note_changed() {
  if [ -n "${UPDATE_CHANGED:-}" ]; then echo "$1" >> "$UPDATE_CHANGED"; fi
}

# sync_file <src> <dst> <label> [extra install(1) args]: install src over dst when they differ.
# Returns 0 if a change was (or, in dry-run, would be) made, 1 if already identical.
sync_file() {
  local src="$1" dst="$2" label="$3" extra="${4:-}"
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then return 1; fi
  if [ -f "$dst" ]; then log "$label: differs from the repo, updating"; else log "$label: not present, installing"; fi
  # shellcheck disable=SC2086
  run $SUDO install -m 644 $extra "$src" "$dst"
  return 0
}
