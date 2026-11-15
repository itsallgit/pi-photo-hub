#!/bin/bash
# apply-extras.sh - the non-unit parts of an update, called by scripts/update.sh:
#   * API dependencies (npm install, only if api/package.json changed or node_modules is missing)
#   * Picapport's properties file (copied; Picapport is NOT restarted, see update.sh output)
#   * the logrotate config and the health-log cron entry: always installed or refreshed
#     (they are part of the app; owner decision 2026-11-15, backlog B20)
# Env: SRC (tree to apply, required), REPO (the real checkout; default SRC), CHANGED_FILES
# (file listing the repo files that changed in this update), DRY_RUN, UPDATE_CHANGED.
set -euo pipefail
SRC="${SRC:?SRC (the source tree to apply) is required}"
REPO="${REPO:-$SRC}"
CHANGED_FILES="${CHANGED_FILES:-/dev/null}"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

# --- API dependencies -------------------------------------------------------------
if grep -qx 'api/package.json' "$CHANGED_FILES" || [ ! -d "$REPO/api/node_modules" ]; then
  log "api: installing dependencies (package.json changed or node_modules missing)"
  if [ "$DRY_RUN" = 1 ]; then
    log "  [dry-run] would run: (cd $REPO/api && npm install --no-audit --no-fund)"
  else
    ( cd "$REPO/api" && PATH="/opt/node/bin:$PATH" npm install --no-audit --no-fund )
  fi
  note_changed "api-deps"
else
  log "api: dependencies unchanged"
fi

# --- Picapport properties ---------------------------------------------------------
if [ -d "$(dirname "$PICAPPORT_PROPS_DST")" ]; then
  if sync_file "$SRC/config/picapport.properties" "$PICAPPORT_PROPS_DST" "picapport.properties" "$OWNER_ARGS"; then
    note_changed "picapport-properties"
  else
    log "picapport.properties: already matches the repo"
  fi
else
  log "picapport.properties: Picapport home not found, skipped"
fi

# --- logrotate --------------------------------------------------------------------
LR_DST="$LOGROTATE_DIR/pi-photo-hub"
# logrotate lives in /usr/sbin, which is not on user pi's PATH over SSH.
LOGROTATE_BIN="${LOGROTATE_BIN:-$(command -v logrotate 2>/dev/null || { [ -x /usr/sbin/logrotate ] && echo /usr/sbin/logrotate; } || true)}"
if [ -n "$LOGROTATE_BIN" ]; then
  if [ "$DRY_RUN" != 1 ]; then
    $SUDO "$LOGROTATE_BIN" -d "$SRC/config/logrotate-pi-photo-hub" >/dev/null 2>&1 \
      || die "logrotate rejected config/logrotate-pi-photo-hub; nothing installed"
  fi
  if sync_file "$SRC/config/logrotate-pi-photo-hub" "$LR_DST" "logrotate config"; then
    note_changed "logrotate"
  else
    log "logrotate config: already matches the repo"
  fi
else
  log "[WARN] logrotate is not installed on this machine: its config was not installed"
fi

# --- health-log cron entry --------------------------------------------------------
if [ "$(id -un)" = "$OWNER" ]; then
  cron_now="$(crontab -l 2>/dev/null || true)"
else
  cron_now="$($SUDO crontab -u "$OWNER" -l 2>/dev/null || true)"
fi
if printf '%s\n' "$cron_now" | grep -q 'pi-photo-hub health-log'; then
  log "health log: refreshing the cron entry"
else
  log "health log: installing the cron entry (scripts/health-log.sh every minute; its data is kept in RAM)"
fi
run bash "$SRC/scripts/install-health-log.sh"
note_changed "health-log-cron"
