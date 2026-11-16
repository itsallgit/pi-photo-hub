#!/bin/bash
# apply-logging.sh - the project's logging standard (backlog B09), called by scripts/update.sh
# and bootstrap.sh:
#   * persistent journal: config/journald-pi-photo-hub.conf -> /etc/systemd/journald.conf.d/
#     (when it changes: restart systemd-journald and flush, so it applies at once)
#   * /var/log/pi-photo-hub/ exists, and health.log in it is writable by the owner (pi), so the
#     per-minute health log survives a reboot (scripts/health-log.sh; screenshots stay in RAM)
# Rotation of the files in /var/log/pi-photo-hub/ is config/logrotate-pi-photo-hub (apply-extras.sh).
# Env: SRC (tree to apply, required), DRY_RUN, UPDATE_CHANGED; JOURNALD_DIR and HEALTH_LOG can
# be overridden for testing.
set -euo pipefail
SRC="${SRC:?SRC (the source tree to apply) is required}"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
JOURNALD_DIR="${JOURNALD_DIR:-/etc/systemd/journald.conf.d}"
HEALTH_LOG="${HEALTH_LOG:-$LOG_DIR/health.log}"

# --- persistent journal ------------------------------------------------------------
JCONF="$SRC/config/journald-pi-photo-hub.conf"
if [ -f "$JCONF" ]; then
  [ -d "$JOURNALD_DIR" ] || run $SUDO mkdir -p "$JOURNALD_DIR"
  if sync_file "$JCONF" "$JOURNALD_DIR/pi-photo-hub.conf" "journald config"; then
    log "journald: restarting systemd-journald so the setting applies now (logs are kept from here on)"
    run $SUDO "$SYSTEMCTL" restart systemd-journald
    if [ "$DRY_RUN" != 1 ]; then $SUDO journalctl --flush >/dev/null 2>&1 || true; fi
    note_changed "journald"
  else
    log "journald config: already matches the repo"
  fi
fi

# --- health log on the SD card -----------------------------------------------------------
[ -d "$LOG_DIR" ] || { log "log folder $LOG_DIR: missing, creating it"; run $SUDO mkdir -p "$LOG_DIR"; }
owner_now="$(stat -c '%U' "$HEALTH_LOG" 2>/dev/null || true)"
if [ "$owner_now" = "$OWNER" ] || ! id "$OWNER" >/dev/null 2>&1; then
  log "health log: $HEALTH_LOG present"
else
  log "health log: creating $HEALTH_LOG for $OWNER (the per-minute health log is kept there from now on)"
  if [ -f "$HEALTH_LOG" ]; then
    run $SUDO chown "$OWNER:$OWNER" "$HEALTH_LOG"
  else
    run $SUDO install -m 644 -o "$OWNER" -g "$OWNER" /dev/null "$HEALTH_LOG"
  fi
  note_changed "health-log-file"
fi
