#!/bin/bash
# picapport-db.sh - diagnose and repair Picapport's database (OrientDB) without rebuilding it.
# Run on the Pi as user pi. The picapport-db skill says when and how; docs/picapport-db.md holds
# the facts and the case history.
#
#   picapport-db.sh status               read-only: Picapport state, DB size, dirty flag, recent
#                                        broken-page errors in Picapport's log, existing snapshots
#   picapport-db.sh snapshot [--dry-run] stop Picapport, copy the whole db/ folder to a new
#                                        read-only snapshot under the work directory, start
#                                        Picapport and the slideshow again (a few minutes)
#
# Snapshots live in $WORK_DIR (default /home/pi/picapport-db-work, on the SD card). They are
# never modified: repair attempts work on further copies. The live database is never changed
# by this script (yet); swapping in a repaired copy will be a separate, agreed subcommand.
# It never touches the photo HDD (/mnt/photos), never restarts mount-hdd, never reboots.
set -euo pipefail

PICAPPORT_HOME="${PICAPPORT_HOME:-/opt/picapport/.picapport}"
DB_PARENT="$PICAPPORT_HOME/db"
DB_NAME="${DB_NAME:-db_3_0_39}"
WORK_DIR="${WORK_DIR:-/home/pi/picapport-db-work}"
LOG_DIR="${LOG_DIR:-/var/log/pi-photo-hub}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
JOURNALCTL="${JOURNALCTL:-journalctl}"
CURL="${CURL:-curl}"
PGREP="${PGREP:-pgrep}"
START_WAIT="${START_WAIT:-180}"
if [ -z "${SUDO+x}" ]; then
  if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
fi

DRY_RUN=0
usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; }

log() {
  local m; m="[$(date '+%F %T')] $*"
  echo "$m"
  if [ "$DRY_RUN" != 1 ]; then
    $SUDO mkdir -p "$LOG_DIR" 2>/dev/null || true
    printf '%s\n' "$m" | $SUDO tee -a "$LOG_DIR/picapport-db.log" >/dev/null 2>&1 || true
  fi
}
die() { log "[ERROR] $*"; exit 1; }

java_running() { $PGREP -f picapport-headless.jar >/dev/null 2>&1; }
newest_pp_log() { ls -t "$PICAPPORT_HOME"/logfiles/picapport.* 2>/dev/null | head -1; }

# Refuse anything that would point at the photo HDD (hard rule 1).
guard_paths() {
  local p
  for p in "$WORK_DIR" "$PICAPPORT_HOME"; do
    case "$(readlink -m "$p")" in /mnt/photos|/mnt/photos/*) die "path $p is on the photo HDD; refusing" ;; esac
  done
}

# ---------------------------------------------------------------------------------------
cmd_status() {
  local db="$DB_PARENT/$DB_NAME" f
  echo "Picapport service: $($SYSTEMCTL is-active picapport-wrapper 2>/dev/null || true)   java running: $(java_running && echo yes || echo no)"
  echo "HTTP :8080/picapport: $($CURL -s -o /dev/null -w '%{http_code}' -m 10 http://localhost:8080/picapport 2>/dev/null || true)"
  if [ -d "$db" ]; then
    echo "Database: $db  size $(du -sh "$db" | cut -f1)  files $(find "$db" -type f | wc -l)"
    echo "  newest file write: $(find "$db" -type f -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort | tail -1)"
    if [ -f "$db/dirty.fl" ]; then
      echo "  dirty flag (dirty.fl first byte, 1 = not closed cleanly): $(od -An -tu1 -N1 "$db/dirty.fl" | tr -d ' ')"
    fi
  else
    echo "Database: $db NOT FOUND"
  fi
  f="$(newest_pp_log)"
  if [ -n "$f" ]; then
    echo "Picapport log: $f"
    echo "  broken-page reports in it (count, files and pages):"
    grep -o "detected to be broken \[[^]]*\]" "$f" | sort | uniq -c | sed 's/^/    /' || echo "    none"
    echo "  other error classes in it (count):"
    grep '^ERROR@' "$f" | grep -v OPageIsBrokenException \
      | sed -E 's/.*Exception Error ([^:]+): ([A-Za-z0-9_.$]+).*/\2   (in \1)/' \
      | sed -E 's/^[a-z0-9_.]+\.([A-Z])/\1/' | sort | uniq -c | sort -rn | head -8 | sed 's/^/    /' || true
  fi
  echo "Snapshots in $WORK_DIR:"
  ls -1d "$WORK_DIR"/snapshot-* 2>/dev/null | while read -r s; do echo "  $s  $(du -sh "$s" | cut -f1)"; done || true
  [ -n "$(ls -d "$WORK_DIR"/snapshot-* 2>/dev/null)" ] || echo "  none"
}

# ---------------------------------------------------------------------------------------
cmd_snapshot() {
  local db="$DB_PARENT/$DB_NAME" ts dest need avail t0 t1 since
  guard_paths
  [ -d "$db" ] || die "database not found: $db"
  ts="$(date +%Y%m%d-%H%M%S)"; dest="$WORK_DIR/snapshot-$ts"
  need=$(( $(du -sk "$DB_PARENT" | cut -f1) * 3 ))
  mkdir -p "$WORK_DIR" 2>/dev/null || [ "$DRY_RUN" = 1 ] || die "cannot create $WORK_DIR"
  avail=$(df -Pk "$( [ -d "$WORK_DIR" ] && echo "$WORK_DIR" || dirname "$WORK_DIR")" | awk 'NR==2{print $4}')
  log "snapshot: $DB_PARENT ($(du -sh "$DB_PARENT" | cut -f1)) -> $dest"
  [ "$avail" -gt "$need" ] || die "not enough free space in $WORK_DIR (need about $((need/1024)) MB for this and two working copies, have $((avail/1024)) MB)"

  if [ "$DRY_RUN" = 1 ]; then
    log "DRY RUN. Would:"
    log "  1. $SUDO $SYSTEMCTL stop picapport-wrapper   (slideshow stops; time it; check java exits)"
    log "  2. cp -a $DB_PARENT $dest/db, then compare every file, write $dest/SHA256SUMS, make it read-only"
    log "  3. $SUDO $SYSTEMCTL start picapport-wrapper, wait up to ${START_WAIT}s for :8080"
    log "  4. $SUDO $SYSTEMCTL start picapport-chromium   (the boot's slideshow launcher)"
    log "  If anything fails after step 1, Picapport is started again before exiting."
    log "  Not touched: the live database (only read), the photo HDD, mount-hdd, photo-api."
    exit 0
  fi

  # From here on, always try to bring Picapport back, whatever happens.
  restart_needed=0
  trap 'if [ "$restart_needed" = 1 ]; then log "[WARN] exiting early: starting Picapport again"; $SUDO "$SYSTEMCTL" start picapport-wrapper || true; $SUDO "$SYSTEMCTL" start picapport-chromium || true; fi' EXIT

  since="$(date '+%F %T')"
  log "stopping Picapport (picapport-wrapper)"
  restart_needed=1
  t0=$(date +%s)
  $SUDO "$SYSTEMCTL" stop picapport-wrapper
  t1=$(date +%s)
  log "  stop took $((t1 - t0)) s"
  if java_running; then die "Picapport's java process is still running after the stop; not copying a live database"; fi
  # Evidence for backlog Q11: did systemd have to kill it, and did Picapport log a clean shutdown?
  $JOURNALCTL -u picapport-wrapper --since "$since" --no-pager 2>/dev/null | grep -Ei 'kill|timed out|sigterm|sigkill|stopped|deactivated' | sed 's/^/    journal: /' || true
  log "  Picapport log after the stop request:"
  tail -n 5 "$(newest_pp_log)" 2>/dev/null | cut -c1-200 | sed 's/^/    /' || true

  log "copying"
  mkdir -p "$dest"
  cp -a "$DB_PARENT" "$dest/db"
  diff -rq "$DB_PARENT" "$dest/db" >/dev/null || die "the copy differs from the original"
  ( cd "$dest/db" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > "$dest/SHA256SUMS"
  {
    echo "snapshot of $DB_PARENT taken $(date '+%F %T')"
    echo "picapport stop took $((t1 - t0)) s"
    echo "files $(find "$dest/db" -type f | wc -l), size $(du -sh "$dest/db" | cut -f1)"
  } > "$dest/INFO"
  chmod -R a-w "$dest"
  log "  copied and verified: $(find "$dest/db" -type f | wc -l) files, $(du -sh "$dest/db" | cut -f1); read-only"

  log "starting Picapport"
  $SUDO "$SYSTEMCTL" start picapport-wrapper || die "systemctl start picapport-wrapper failed (journalctl -u picapport-wrapper -n 30)"
  local i code=000
  for ((i = 0; i < START_WAIT; i += 5)); do
    code="$($CURL -s -o /dev/null -w '%{http_code}' -m 5 http://localhost:8080/picapport 2>/dev/null || true)"
    [ "$code" = 200 ] && break
    sleep 5
  done
  log "  Picapport HTTP: $code after about ${i}s"
  [ "$code" = 200 ] || die "Picapport did not answer within ${START_WAIT}s (see journalctl -u picapport-wrapper)"
  log "relaunching the slideshow (picapport-chromium)"
  $SUDO "$SYSTEMCTL" start picapport-chromium || log "[WARN] slideshow launcher failed (journalctl -u picapport-chromium)"
  restart_needed=0
  log "snapshot done: $dest"
  log "Undo: nothing to undo on the live system; to delete the snapshot: chmod -R u+w $dest && rm -r $dest"
}

# ---------------------------------------------------------------------------------------
cmd="${1:-}"; [ $# -gt 0 ] && shift
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
case "$cmd" in
  status) cmd_status ;;
  snapshot) cmd_snapshot ;;
  -h|--help|"") usage ;;
  *) echo "unknown command: $cmd (see --help)" >&2; exit 2 ;;
esac
